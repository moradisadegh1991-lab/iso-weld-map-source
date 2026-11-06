# Phase 2d.1 — Database integrity and append-only hardening

Branch `fix/phase-2d-database-integrity`, from `master` at `6f40e56` (Phase 2d merged). Migration **102**.

> **Superseded in part by migration 103 (Phase 2d.2, `phase-2d2-audit-retention.md`):** the two composite foreign keys, the NO ACTION activity policy and the key targets described below were replaced by an insert-time check plus an immutable snapshot, because the cascade from the spool key deleted the audit trail whenever a register was re-derived. What stays: NOT NULL activity, the unconditional no-UPDATE trigger, REVOKE, RLS, and the guarantee that an event can only be written for its own project's spool and an activity of that spool.

## 1. The gaps (found in the Phase 2d review, confirmed against the schema)

| # | Gap in migration 101 | Evidence |
|---|---|---|
| A | `material_override` had separate keys `project_id → project` and `spool_id → spool`. Nothing said the spool is *that project's* spool, nor that `activity_id` is an activity *of that spool*. A row could name project A with project B's spool; RLS only checks `project_id = current_project_id()`. | `\d material_override` at 101: `material_override_project_id_fkey`, `…_spool_id_fkey`, `…_activity_id_fkey`, all single-column. `spool` had no `(project_id, id)` key to target. |
| B | The append-only trigger passed an UPDATE whose only change was `activity_id → NULL` (to serve `ON DELETE SET NULL`). The test could not tell the foreign-key action from an ordinary statement. | `material-override-migration.mjs` runs `UPDATE … SET activity_id = NULL` as the table owner on a database at 101: it **succeeds** (the weakness, shown), and is refused after 102. |

What *did* hold at 101: `app_rw` has no UPDATE/DELETE/TRUNCATE (REVOKE), so the ordinary application could not reach the exception. The gap was owner/superuser level and defence in depth.

## 2. Schema changes (`db/migrations/102_material_override_integrity.sql`)

1. **Pre-flight, then stop.** Inside the migration's transaction, with `FORCE ROW LEVEL SECURITY` lifted on the three tables for the checks only (as 012 does — otherwise a non-superuser owner sees zero rows and passes silently) and restored right after, it looks for: an event whose spool belongs to another project; an event whose activity is not of its project and spool; an event with no activity. Any hit raises an exception **naming the event ids** and the migration (a transaction) changes nothing and is not recorded. No event is deleted or rewritten.
2. `spool`: `UNIQUE (project_id, id)` (`spool_project_id_id_key`). `spool_activity`: `UNIQUE (id, project_id, spool_id)` (`spool_activity_id_project_spool_key`). `id` is already the primary key, so both hold for every existing row; they exist only as foreign-key targets.
3. Dropped: `material_override_project_id_fkey`, `…_spool_id_fkey`, `…_activity_id_fkey` (implied by the composite keys — keeping them would be redundant).
4. Added: `material_override_spool_fkey (project_id, spool_id) → spool (project_id, id) ON DELETE CASCADE`.
5. `activity_id SET NOT NULL`; added `material_override_activity_fkey (activity_id, project_id, spool_id) → spool_activity (id, project_id, spool_id)` with **NO ACTION**.
6. `material_override_append_only()` now raises on every UPDATE (`42501`), no condition.

Kept as in 101: RLS `project_isolation` (USING and WITH CHECK), `REVOKE UPDATE, DELETE, TRUNCATE FROM app_rw`, `authorized_by → app_user`, the CHECKs, the indexes. The `authorized_by` key stays single-column (users are global, not project-scoped).

### Why the activity key is NO ACTION and not SET NULL

A composite foreign key with `SET NULL` would null *all* its columns (`project_id`, `spool_id` are NOT NULL) unless PostgreSQL 15's column-list form is used — and any SET NULL needs an UPDATE of the event, which is exactly the exception to remove. The alternative was chosen on the brief's own terms ("restrict deletion of referenced activities, provided existing product behaviour and audit retention are preserved"):

* The application never deletes a `spool_activity` row on its own. Code paths that touch the table: `recordSpoolActivity` (INSERT … ON CONFLICT DO UPDATE), `stampClaim`/claims (UPDATE), and deletion only by cascade from `spool` / `project` (`review.mjs` re-derivation, project removal). Searched: `lib`, `app`, `tools`; `trash`/`removal` do not handle this table.
* A cascade from the spool or project removes the steps and the events in the **same statement**; NO ACTION is checked at the end of the statement, when no referencing event is left, so it passes. A direct `DELETE FROM spool_activity` of a step that has events is now refused (`23503`, `material_override_activity_fkey`). A step with no events deletes as before.
* So audit retention is *improved* (an event can no longer be detached from its step) and no product behaviour is lost.

## 3. Trigger design and its security boundary

* `app_rw`: cannot UPDATE/DELETE/TRUNCATE — the privilege stops it before any trigger runs (`permission denied for table material_override`, on PGlite and PostgreSQL alike inside a project scope).
* Owner/superuser: the `BEFORE UPDATE` trigger refuses every update, for every column, unconditionally. There is **no** `pg_trigger_depth()` or caller test to exploit: with no SET NULL action left, no legitimate caller needs to update the table, so the safest rule is "never". Because the exception was removed rather than hardened, there is nothing for ordinary SQL to impersonate.
* What is *not* protected: a superuser can `ALTER TABLE … DISABLE TRIGGER`, `DROP` it, or `TRUNCATE`; the owner is not blocked from DELETE/TRUNCATE (cascades need DELETE). Append-only against a DBA is a process matter (backups, `schema_migrations` checksums), not something a trigger can give. The application role is fully restricted.

## 4. PostgreSQL-specific behaviour verified

* RI cascade runs as the owner of the referencing table; cascade `DELETE FROM spool` removes steps and events together under FORCE RLS (B13).
* FK catalogue on PostgreSQL 16: `material_override_activity_fkey` `confdeltype='a'` (no action), `material_override_spool_fkey` `'c'` (cascade), `material_override_authorized_by_fkey` `'a'` (B13).
* Default privileges from 001 grant `app_rw` everything on a new table; the REVOKE is what closes it (found in Phase 2d on PostgreSQL).
* `ALTER TABLE … ADD FOREIGN KEY` validation reads existing rows irrespective of RLS; the explicit pre-flight exists to give a readable report instead.

## 5. Tests and results (this session, local; counts from each run's own output)

Added/extended: `db/test/material-override.mjs` (15), new `db/test/material-override-migration.mjs` (6, in the `db:test` chain), `B13` in `db/test/material-concurrency.mjs` (PostgreSQL only).

| Required case | Where |
|---|---|
| 1 valid override with matching project/spool | `3–5.` and `composite keys` (valid shape accepted) |
| 2–3 cross-project spool refused, including direct SQL | `composite keys` (INSERTs issued directly, from both scopes; `…_spool_fkey`), B13 on PostgreSQL |
| 4 valid activity reference preserved | `composite keys`, `activity deletion policy` |
| 5 activity deletion follows the chosen policy | `activity deletion policy` (alone: refused; with its spool: both go; no-event step deletes) |
| 6–10 direct UPDATE of reason / authorized_by / authorized_at / warnings / activity_id→NULL (and code, source+op_id, spool_id, project_id) refused | `append-only: every UPDATE…` (app_rw), `the old exception is gone` (owner, trigger), B13 (app_rw + owner on PostgreSQL) |
| 11 DELETE and TRUNCATE refused for app_rw | `append-only…`, B13 |
| 12 project isolation | `10. another project sees none of it` (unchanged, green) |
| 13–14 offline replay/idempotency, rollback | unchanged tests, green (incl. B12 on PostgreSQL) |
| Migration over data | `material-override-migration.mjs`: sound data kept byte-for-byte; stops and names the event for a foreign-project spool, a foreign-spool activity, a foreign-project activity, and an event that lost its activity at 101; nothing changed, 102 not recorded |

Guards proved by reverting: composite keys removed ⇒ 3 tests red (`activity deletion policy`, `composite keys`, `10.`); trigger body replaced by `RETURN NEW` ⇒ `the old exception is gone` red.

| run | passed | failed | skipped |
|---|---|---|---|
| `db/test/material-override.mjs` on PGlite | 15/15 | 0 | 0 |
| `db/test/material-override-migration.mjs` on PGlite | 6/6 | 0 | 0 |
| same two files on real PostgreSQL 16.15 (`DATABASE_URL`, fresh database each) | 15/15 and 6/6 | 0 | 0 |
| `spool-step-material.mjs` on PostgreSQL 16 | 6/6 | 0 | 0 |
| `npm run db:test` (whole chain, PGlite) | 1389/1389 in 112 files, exit 0 | 0 | 0 |
| `npm run db:test:pg` with `PG_TEST_URL` (pg-scope 8/8; material-concurrency incl. B12, B13) | 8/8 + 15/15 | 0 | 0 |
| full migration chain from an empty PostgreSQL 16 database | 104 migrations applied (last: 100, 101, 102); a second run applies 0; 104 rows in `schema_migrations` | | |
| full chain on PGlite | inside every `db:test` file (each starts from an empty directory) | | |
| `npm run eval:check` | `GATE PASSED` | | |
| `npx next build` | exit 0 | | |

A PGlite pass is reported as PGlite. Statements about `confdeltype`, privileges as a real role, and cascade under FORCE RLS rest on the PostgreSQL runs above (B13 and the pg-suite runs), not on PGlite.

Not executed: GitHub Actions on this branch (not pushed at the time of writing), the guided-scenario UI drive, a browser look, a managed/remote PostgreSQL.


## 6. Compatibility

* Additive in data terms: no row is changed. Constraints tighten; on a database with sound data the migration applies without effect on rows (tested). On a database where a violation exists it stops with the offenders listed and must be resolved by hand — the only realistic case is an event whose step was deleted at 101 (SET NULL); no application path does that.
* No API, repository or UI change. `recordSpoolActivity`, `applyOps`, the history reader are untouched.
* Deploy: `sudo epc backup && sudo epc update` (the migration runs in its own transaction; a pre-flight failure leaves the schema at 101).

## 7. Known limitations and risks

* **(Closed by 103.)** **Register re-derivation deletes events.** `review.mjs` (edit a register) deletes the run's `spool` rows and re-inserts them with new ids. That already deletes their `spool_activity` rows (existing behaviour); with the spool key `ON DELETE CASCADE` — which the brief asked to keep — it deletes their override events too. This phase does not change it ("do not change existing behaviour"). The way to close it is a separate decision: keep events with their own copy of the spool number and no cascade from the spool, or stop re-deriving spools by delete-and-insert. **Open risk for the owner.**
* A project deletion removes its events (cascade), as it removes everything else of the project.
* The trigger cannot defend against a superuser who disables it; TRUNCATE by the owner is not blocked.
* Pre-flight text lists the offending event ids but does not propose a repair.
* Not executed: UI drive of the guided scenario; GitHub Actions at the time of writing (see the PR); a managed/remote PostgreSQL; production data.

## 8. Files

`db/migrations/102_material_override_integrity.sql` (new) · `db/test/material-override.mjs` · `db/test/material-override-migration.mjs` (new) · `db/test/material-concurrency.mjs` · `package.json` (`db:test` chain) · `docs/audit/phase-2d-material-override-audit.md` (superseded claims marked) · this document.
