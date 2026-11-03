# Phase 1 audit — database scope, transaction safety, area authorization (2026-11-03)

Branch `audit/phase-1-db-security`. Written from what the code and a real PostgreSQL 16 showed; where an item of the
audit brief did not hold, it says so.

## 1. Original defects

**D1 — project scope on node-postgres (confirmed, serious).** `withProject` set `app.project_id` (session-level) and
`SET ROLE app_rw` with `db.query`, which on the `pg` driver is `pool.query`: whichever connection is idle. The callback's
own queries, and a `db.transaction` opened inside it, each took *another* connection. Measured on PostgreSQL 16 with the
old code (40 concurrent requests on two projects, 320 queries): **125 ran under another project's scope, 64 ran as the
login role** (past row security), and an idle pooled connection kept the last request's project. Sequential use looked
fine only because the pool hands back the one idle connection. The comment in `scope.mjs` ("scoping is the
transaction's business") was wrong: the transaction never applied the scope.

**Who is affected.** Only deployments with `DATABASE_URL` (the Vercel path in `docs/DEPLOY.md`). **The VPS runs PGlite**
(`deploy/vps/install.sh` sets `PGLITE_DIR`), where `exclusive()` serialises scoped blocks on one connection — not
affected, and not touched by this change.

**D2 — areas (confirmed).** `/api/bom-allocations` and `/api/iso-equipment` were in no area, so open to every member;
`/api/ndt-joints` likewise (its menu entry says `quality`, the server enforced nothing). 43 write routes had no
classification at all and nothing said whether that was a decision.

**D3 — field-sync idempotency (NOT a defect).** `field_op.op_id` is the primary key; `applyOps` inserts the record in the
*same transaction* as the operation's effect and maps `23505` to the stored outcome, so a second copy rolls back its own
effect. The brief's premise did not hold. What was missing was a test with real concurrency (PGlite serialises, so it
cannot be written there): `db/test/pg-scope.mjs` test 12 — it passes on the old and the new client, as it should.

## 2. Transaction architecture (node-postgres)

`lib/db/client.mjs`, `lib/db/scope.mjs`. One scoped block = **one dedicated connection**, bound to the block's async
context (`AsyncLocalStorage`):

- the role and project are applied on that connection; every `db.query` inside — by callers that keep using the `db`
  they already hold, ~190 files unchanged — goes to it;
- on exit, success or error, they are cleared on it before it goes back to the pool; a connection that cannot be cleared
  is destroyed (`release(err)`), never reused;
- `db.transaction` inside is `BEGIN`/`COMMIT` on the same connection (the scope holds inside it); one inside another
  transaction, or a `withProject` inside one, is a `SAVEPOINT` (with transaction-local `SET LOCAL`), so it composes, never
  starts an independent transaction, and rolls back alone;
- `outsideScope` leaves the pg binding as well as the PGlite lock (background work, the OCR queue);
- `DATABASE_POOL_MAX` (default 10) is the number of blocks that run at once.

**Deviation from the brief, on evidence.** The brief asked for each block to be one transaction with `SET LOCAL`. I built
that first and ran the existing suites on a real server: it failed tests of three suites, because inside one transaction a
caught failed statement aborts it and the final `COMMIT` **silently rolls back every earlier write of the block**.
Production code relies on the opposite — `doc-control/incoming` ("statements here commit one by one: the reply above is
already recorded, whatever happens to the reading"), `eps-scope`, `eps-activities`, `intake`, `kpi` catch and go on. So a
block is not a transaction (as on PGlite); the isolation guarantees the brief wants are all kept, and atomicity stays
where it was declared (`db.transaction`, e.g. the register save in `/api/runs`).

## 3. Callers

`withProject`, `withoutProject` and `db.transaction` callers needed no change: `runs`, `bom-allocations` (a transaction in
a scope → one transaction on the scope's connection), `field.applyOps` (a transaction, then a scope inside → savepoint),
`extract` (its slow model call is outside any scope; only short DB calls inside). Reading a drawing inside a scope
(`doc-control/incoming`) holds a connection for seconds → `DATABASE_POOL_MAX`.

## 4. Authorization coverage (`lib/platform/areas.mjs`, `db/test/area-coverage.mjs`)

88 write routes: **50 with an area**, 3 per operation (`field`, `ndt-joints`, `forms`), 23 common with a written reason,
12 named for review. A route in none of them now fails the test.

Added: `bom-allocations`, `iso-equipment`, `read-local`, `registry-check`, `drawing-styles` → piping (the isometric
workspace, like `/api/extract`). `ndt-joints` per operation (`areaForNdtJoint`): `rule`, `rule-remove`, `joint`, `weld` →
piping (the matrix, the register, site welding); `ndt`, `sample`, `progressive` → quality. Admin/developer bypass and
"no areas = all" are unchanged (same `inArea`).

**For the owner to decide (REVIEW_ROUTES, not changed — restricting them takes work away from members who have it now):**
`assumptions`, `changes`, `contract-reports`, `contractors`, `daily-reports`, `eps`, `eps/activities`, `eps/planning`,
`reference`, `subsystems`, `work`, `records`.

## 5. Tests

| Command | Result |
|---|---|
| `npm run db:test` (PGlite, the whole chain) | exit 0, 0 `FAIL` |
| `npm run eval:check` | `GATE PASSED` |
| `npx next build` | no errors |
| `PG_TEST_URL=… npm run db:test:pg` (real PostgreSQL 16) | 8/8 on the new code; **3/8 on the old code** (it fails 1-2, parallel queries, 5-6, 8, outsideScope) |
| each of the 104 `db/test/*.mjs` files, one fresh PostgreSQL 16 database each, `DATABASE_URL` set | 102 pass in full. **`run`: 1 expected failure** — it asserts the suites never see a `DATABASE_URL`, which is what this run sets. **`migrations`: crashes (`itp_scope_known`) the same way on the old client** — it is written for PGlite; not caused by this change. |
| revert check of the area guards | with the `ndt-joints` check and the two `API_AREAS` entries removed, `area-coverage` and `users` fail |
| CI | new job `pg-scope` (postgres:16 service) |

`db:test:pg` without `PG_TEST_URL` prints SKIPPED and exits 0 — that is not a pass. PGlite tests prove nothing about
pool behaviour; only `db:test:pg` does.

## 6. Remaining risks

- Slow work inside a scope holds a connection; size `DATABASE_POOL_MAX` for it.
- A failed statement inside a block is not rolled back with the block (as on PGlite); atomic units must use `db.transaction`.
- The 12 REVIEW routes remain open to every area.
- Not touched: Vercel-style deployments should set `DB_AUTO_MIGRATE=off` and run `npm run db:migrate` as a deploy step.

## 7. Deployment

**VPS (PGlite) — nothing to configure, no migration** (no schema change): `sudo epc backup && sudo epc update`
(`docs/DEPLOY-VPS.md`). The change is inert there.

**A `DATABASE_URL` deployment:** deploy, restart; no migration. Set `DATABASE_POOL_MAX` if requests read drawings. The
database user must be allowed `SET ROLE app_rw` (migration `001_core.sql` creates the role; a superuser or a member
works) and must not be a way around row security other than through that role.
