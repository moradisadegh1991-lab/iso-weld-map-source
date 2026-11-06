# Phase 2d — Material override audit trail

Branch `audit/phase-2d-override-trail`, from `master` at `f033500` (Phase 2c merged).

## 1. The problem

Since Phase 2c a spool step that consumes material (`fit_up`, `erected`) is refused while the spool's tracked material
is not all issued; `materialOverride` (a reason) lets it through. The reason was stored **only inside
`spool_activity.note`**, which is one column on a row the next update of the step rewrites
(`note = COALESCE(EXCLUDED.note, spool_activity.note)`), with no author other than `recorded_by` (also overwritten), no
server-side time other than `recorded_at` (also overwritten), and no way to ask "which overrides did we allow last
month, by whom?". That is not an audit record.

## 2. Design

A dedicated, **append-only** table `material_override` (migration 101): one row per override event.

| column | meaning |
|---|---|
| `id` | event id |
| `project_id` → `project` (cascade) | scope; RLS `project_isolation` |
| `spool_id` → `spool` (cascade) | the spool |
| `activity_id` → `spool_activity` | the step row that was written. *(101: ON DELETE SET NULL, nullable. **Superseded by 102 — see `phase-2d1-database-integrity.md`:** NOT NULL, NO ACTION, composite key.)* |
| `code` | the step (`fit_up` / `erected`) — kept on the event itself |
| `reason` | normalised (trimmed, whitespace collapsed, ≤ 1000 chars); CHECK non-blank |
| `warnings` jsonb | what was outstanding when it was overridden (the same text the answer carries) |
| `authorized_by` → `app_user` | the **session's** user |
| `authorized_at` | `DEFAULT clock_timestamp()` — the database server's clock |
| `source` | `web` \| `offline` (CHECK) |
| `op_id` | the field operation id (offline); `UNIQUE` where not null; CHECK: offline ⇒ op_id present |

Indexes: `(project_id, authorized_at DESC)`, `(spool_id, authorized_at DESC)`, `(activity_id)`, unique `(op_id)`.

Append-only is enforced three ways: (1) `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_rw` (as 018/019/020 do — the default
privileges of 001 grant everything, the first run on PostgreSQL showed the GRANT alone is not enough); (2) a `BEFORE
UPDATE` trigger that refuses any change (the owner included) *(101 let the RI action that nulls `activity_id` through; 102 removed that exception)*; (3) the
application has no endpoint that updates or deletes an event. Rows leave only with their spool or project.

**Not done, on purpose:** nothing was back-filled from old notes. An override that only ever existed as text in a note
stays a note.

## 3. Repository (`lib/db/repos/piping-execution.mjs`)

`recordSpoolActivity` gained `membership`, `source` (`"web"` default) and `opId`.

1. Warnings are computed as before. No reason ⇒ 400 (as before). The message mentions `materialOverride` only to a
   member who may override.
2. With a reason: needs a user, and `can(membership, OVERRIDE_MATERIAL)` — otherwise **403**. No `membership` (an
   internal caller with no person behind it) cannot override: it fails closed.
3. The activity upsert, the claim stamp and the `INSERT INTO material_override` run in **one `db.transaction`**
   (savepoint when nested in the offline sync's transaction). If the event cannot be written the step is not.
4. The note still gets the `[مواد حواله‌نشده — reason]` suffix (kept for the existing screens/reports) but it is no
   longer the record.
5. New reader `materialOverrides(db, { projectId, spoolId?, limit })`, newest first, with the person's name.

## 4. Authorization

New action `OVERRIDE_MATERIAL` (`material:override`) in `lib/authz.mjs`: granted to **engineer**, **admin**, developer.
`qc` (and everybody else who holds `ASSIGN_WELD`) does **not** have it. Recording progress is not the decision to proceed
against the warehouse's records.

> **Behaviour change to be aware of:** in Phase 2c any member with `ASSIGN_WELD` (QC included) could override. Now QC
> gets a 403 and is told to ask the project engineer. This is the dedicated-permission requirement of the brief; if the
> site wants QC to keep it, add `ACTIONS.OVERRIDE_MATERIAL` to the `qc` list in `GRANTS` (one line).

The user id is the authenticated session's (route: `user.id`, spread *after* the request body; offline: the syncing
user). `authorized_at` is the server clock; the repository accepts no timestamp or actor from a client (a test sends
`authorizedBy` / `authorizedAt` and shows them ignored).

## 5. Offline synchronisation (`lib/db/repos/field.mjs`)

`spool_step` goes through the same `recordSpoolActivity`, with the sync's `membership`, `source: "offline"` and the
operation id.

* A rejected operation writes no event (the whole operation is one transaction and a refusal throws before the insert).
* An applied override writes exactly one event, with `op_id`.
* A replay returns the recorded outcome before anything runs (`field_op`), so no second event; two copies arriving **at
  once** are caught by the unique `op_id` — and the loser's `23505` on `material_override_op_uq` is now treated like the
  one on `field_op` (answered as a duplicate of the applied one). *Found by the PostgreSQL concurrency test: before that
  line the four losing copies were reported to the phone as `rejected` although the step had been applied.*
* A failure writing the event rolls back the step **and** the `field_op` row; the phone gets `retry` and the resend
  applies once.

## 6. Reading and UI

`GET /api/piping/execution?projectId=…&spoolId=…` now returns `overrides` (project-scoped by `withProject`, RLS and an
explicit `project_id` filter; the route requires `VIEW_PROJECT`). `/piping/execution`, the spool's expanded row, shows
"تاریخچهٔ ادامه بدون حوالهٔ کامل مواد": step, reason, authorised by, date-time, source — three-language dictionary keys
`pi.ex.ovr.*`. The reason prompt's text now says it is recorded with name and time.

## 7. Tests (`db/test/material-override.mjs`, in `db:test`; B12 in `material-concurrency.mjs`, in `db:test:pg`)

Spec items → tests: 1–2 refused (missing, `""`, `"   "`, newline/tab) · 3–5 one event with project, spool, activity,
reason, user, server time (forged actor/time ignored) · 6 failure inserting the event rolls the step back (and the other
way round) · 7 updating the same step keeps both events · 8 replay (same user and another) adds none · 9 rejected
offline ops (no reason, blank, no permission) leave nothing · 10 other project: repository, direct SQL, forged
`projectId`, and an INSERT under another project's scope all give nothing / are refused · 11 QC / viewer / no membership
refused online and offline, admin allowed · 12 steps without material and spools without list unaffected · 13 issued
material ⇒ no override, no event · plus append-only (UPDATE refused; DELETE refused for the application role on
PostgreSQL), reason CHECK, history order, rollback of step + `field_op` offline,
and (PostgreSQL) five simultaneous copies of one op ⇒ one event.

Guards proved by reverting the code they protect: transaction removed ⇒ test 6 red; permission check removed ⇒ test 11
and the offline-rejection test red; REVOKE absent ⇒ PostgreSQL append-only red; the `23505` line absent ⇒ B12 red.

### Results (this session, local; counts from each run's own output)

| run | passed | failed | skipped |
|---|---|---|---|
| `db/test/material-override.mjs` on PGlite | 14/14 | 0 | 0 |
| same file on real PostgreSQL 16 (`DATABASE_URL`) | 14/14 | 0 | 0 |
| `spool-step-material.mjs` on PostgreSQL 16 | 6/6 | 0 | 0 |
| `npm run db:test` (whole chain, PGlite) | 1382/1382 in 111 files, exit 0 | 0 | 0 |
| `npm run db:test:pg` with `PG_TEST_URL` set (pg-scope + material-concurrency incl. B12) | 8/8 + 14/14 | 0 | 0 |
| `npm run eval:check` | `GATE PASSED` | | |
| `npx next build` | exit 0 | | |

Not executed: the UI drive (`tools/drive-scenario-dm-ui.mjs`), a browser look at the new history table, any load test,
a managed/remote PostgreSQL, GitHub Actions (see the PR for its status).


## 8. Known limitations

* **Superseded in part by migration 102 (Phase 2d.1):** the foreign keys, the activity-deletion policy and the trigger exception described above.
* Re-deriving a register (`lib/db/repos/review.mjs`) deletes and re-creates the run's spools; their steps — and, through the spool key, their override events — go with them. That is the existing behaviour for steps; for events it is an audit-retention gap (closed by 103 — see `phase-2d2-audit-retention.md`).

* Overrides recorded before migration 101 exist only as note text.
* The event records the reason and what was outstanding, not a quantity-level snapshot of the ledger.
* Reading is any project member with `VIEW_PROJECT`; there is no separate "audit viewer" permission and no export/report
  page yet (the table is in `reporting`'s reach via `app_report` SELECT but no view is defined).
* The step's `recorded_by`/`recorded_at` still describe the *last* writer; the override event describes the decision.
* `source` distinguishes web from offline only; no IP/device.
* The guided scenario UI drive (`tools/drive-scenario-dm-ui.mjs`) and a browser look at the new table were not run.

## 9. Files

`db/migrations/101_material_override.sql` · `lib/authz.mjs` · `lib/db/repos/piping-execution.mjs` ·
`lib/db/repos/field.mjs` · `app/api/piping/execution/route.js` · `app/piping/execution/page.jsx` ·
`lib/i18n/sections/piping.mjs` · `db/test/material-override.mjs` (new) · `db/test/material-concurrency.mjs` ·
`db/test/spool-step-material.mjs` · `package.json` (`db:test` chain) · this document.

## 10. Deployment

Run migration 101 on the server (`sudo epc backup && sudo epc update`). Additive; no data change.
