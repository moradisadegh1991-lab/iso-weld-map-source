# Phase 2d.2 — Override audit retention across revisions

Branch `fix/phase-2d2-audit-retention`, from `master` at `6c783cc` (Phase 2d.1 merged). Migration **103**.

## 1. What actually deleted the history (traced, not assumed)

The lifecycle of a spool row:

| Event | What happens to spool rows | Effect on override events at 102 |
|---|---|---|
| Upload of the same sheet again / re-run of extraction (`POST /api/runs`) | a **new** `extraction_run`; `saveRegister` inserts **new** spool rows for it (`UNIQUE (extraction_run_id, spool_no)`). The old run's rows stay. | none deleted; the old events stay on the old run's spool ids, which the new spools do not point at |
| New drawing revision | a new `document` row, a new run, new spool rows; old ones stay | same: nothing deleted, history not reachable from the new spool |
| **Correcting / re-deriving a register** (`lib/db/repos/review.mjs` `applyCorrection`, status `extracted` only) | `DELETE FROM weld … run`, then **`DELETE FROM spool WHERE extraction_run_id = $1`** (lines 97–99), then `saveRegister` re-inserts spools with **new ids** | the only statement that erased events: `material_override_spool_fkey … ON DELETE CASCADE` (102) removed every event of the run's spools, together with their `spool_activity` rows (which the same cascade already removed — existing behaviour) |
| Deleting a project | cascade from `project` | all of the project's rows, events included (unchanged, intended) |

No other code path deletes spools (`grep DELETE FROM` over `lib app tools`; `removal.mjs` only handles `weld_joint`). `latestRunForDrawing`/`carryFrom` carry **weld** identity (`weld_uid`) across revisions; spools carry nothing — a spool has no identity across runs.

## 2. Decision

Two options were evaluated.

**A. Preserve spool identity across re-derivation** (upsert by `(run, spool_no)` instead of delete + insert). Rejected for this phase: spool rows are referenced by `spool_material`, `material_reservation`/`material_movement` (SET NULL), `coating_item`, `ship_load_spool` (CASCADE), `pipe_support`, steps… Today a re-derivation silently detaches reservations/issues, deletes coating items and ship loads. Making ids stable would change all of those — material accounting among them — which the brief forbids touching, and it still would not cover spools that disappear from the model, nor a new run/revision (different rows by construction).

**B. An immutable snapshot on the event (chosen).** The spool rows are *generated*; the decision is not. The event now carries its own identity, written once and never changed, and no foreign key leads from it to a generated row:

| column | meaning |
|---|---|
| `spool_id`, `activity_id` | the historical identifiers of the spool and step (plain uuids; may dangle by design) |
| `spool_no` | the spool as printed |
| `run_id`, `document_id` | the extraction run and drawing revision it was made on |
| `doc_no`, `revision`, `sheet_no`, `line_no` | readable context |
| (unchanged) `project_id`, `code`, `reason`, `warnings`, `authorized_by`, `authorized_at`, `source`, `op_id` | |

### Replacing the referential integrity (not just removing keys)

* `project_id → project ON DELETE CASCADE` stays as a key (`material_override_project_fkey`): the whole project going takes its data with it. `authorized_by → app_user` stays.
* The keys of 102 to `spool` and `spool_activity` are replaced by a **`BEFORE INSERT` trigger** (`material_override_check_and_snapshot`): the spool must exist **and belong to the event's project**; the activity must exist **and be an activity of that spool and project**; otherwise `23503` (constraint names kept: `material_override_spool_fkey` / `…_activity_fkey` in the error). It takes `FOR KEY SHARE` on both rows — what a foreign key does — so a concurrent delete of the spool or step **waits** for the insert, and the check cannot race.
* The trigger **fills the snapshot columns itself** from the live rows and overwrites whatever the writer supplied: a snapshot cannot be forged (tested: an INSERT carrying `FORGED` values stores the real ones).
* After the insert the ids may dangle; nothing is ambiguous because the snapshot says which spool, drawing, revision and run they were. No orphan without identity can exist: `spool_no`, `run_id`, `document_id`, `doc_no`, `revision`, `sheet_no` are NOT NULL.
* Dropped as no longer needed: the key targets `spool(project_id, id)` and `spool_activity(id, project_id, spool_id)` of 102 (they cost an index on every spool insert for no remaining purpose).
* **Kept from 102 and tested again:** NOT NULL `activity_id`, unconditional no-UPDATE trigger (now also covering the snapshot columns), `REVOKE UPDATE, DELETE, TRUNCATE`, RLS, CHECKs, indexes.

## 3. Migration 103 (`db/migrations/103_material_override_snapshot.sql`)

1. Adds the seven nullable snapshot columns.
2. Lifts `FORCE ROW LEVEL SECURITY` on the five tables it reads (every one is FORCE'd — verified in the catalogue — and is restored after; otherwise a non-superuser owner sees zero rows and "backfills" nothing silently, as 012/102 explain).
3. Fills existing events from the live rows. This is the **only UPDATE this table ever receives**, inside the migration's transaction, with `material_override_no_update` disabled and re-enabled before the checks. Everything else about an existing event is untouched (tested byte-for-byte for the non-snapshot columns).
4. Stops, changing nothing, if any event could not be filled in (names the ids). (With 102's keys in force this cannot happen on a real database; the guard is there because the next step removes them.)
5. Sets the snapshot NOT NULL, drops the two keys and their targets, adds the project key, the drawing index, the trigger.

No backfill from notes; no event removed.

## 4. Reader (`materialOverrides`)

Unchanged signature, richer rows. It no longer joins `spool`: it reads the snapshot (`spool_no, doc_no, revision, sheet_no, line_no, run_id, document_id`) plus `same_spool`. With a `spoolId` it returns that spool's events **and** those made on the same `doc_no + sheet_no + spool_no` in an earlier derivation, run or revision, each labelled by its own revision. A spool of the same number on another drawing does not see them. The `/piping/execution` history table gains a "drawing · revision" column and marks rows from an earlier derivation. API shape: additive fields only.

## 5. Tests

* `db/test/material-override-retention.mjs` (new, 9, in `db:test`) drives the real flows `createRun → saveRegister → applyCorrection`.
* `db/test/material-override-migration.mjs` (8): the 102 tests now stop at 102; two new 103 tests over data.
* `db/test/material-override.mjs` (15): the 102 activity-deletion policy test replaced by the retention test; the key tests re-expressed against the trigger.
* `B13` in `db/test/material-concurrency.mjs` (PostgreSQL only).

| Required case | Test |
|---|---|
| 1 history survives re-derivation of the same register | `1,4,5,6.` — the spool id changes, the event is byte-identical before and after, twice |
| 2 survives a new extraction run | `2.` |
| 3 old and new revisions distinguishable | `3.` — revision B spool sees the revision 0 event labelled `0`, plus its own |
| 4 historical spool number and identity readable | `1,4,5,6.` (`spool_no`, old `spool_id`, `doc_no`, `revision`) |
| 5 activity references valid or snapshotted | `1,4,5,6.` — the old step row is gone, the event keeps `activity_id` and `code`; the migration test fills them in |
| 6 no duplicates | `1,4,5,6.` (count stays 1 after two re-derivations), `2.`, `3.` |
| 7 failed re-derivation rolls back, history intact | `7.` — failure injected at `INSERT INTO weld` inside the nested transaction: spools and events are exactly as before |
| 8 BOM/MTO behaviour | the existing suites, unchanged and green (`bom-allocation`, `mto-revisions`, `review`, `cut-bom`, … in `db:test`) |
| 9 project isolation | `9.` (reader, RLS, forged `projectId`, insert under another project's scope), `10.` earlier |
| 10 append-only still effective | `10.` (every column incl. snapshot, DELETE), 103 migration test (owner), B13 (app_rw and owner on PostgreSQL) |

Guards proved by reverting: spool key + cascade kept ⇒ 4 retention tests red; snapshot not overwritten ⇒ the forging test red; trigger without `FOR KEY SHARE` ⇒ B13 (concurrent delete) red.

### Results (this session, local; counts from each run's own output)

| run | passed | failed | skipped |
|---|---|---|---|
| `material-override-retention.mjs` (PGlite) | 9/9 | 0 | 0 |
| `material-override-migration.mjs` (PGlite) | 8/8 | 0 | 0 |
| `material-override.mjs` (PGlite) | 15/15 | 0 | 0 |
| the same three files + `spool-step-material.mjs` on real PostgreSQL 16.15 (`DATABASE_URL`) | 9/9, 8/8, 15/15, 6/6 | 0 | 0 |
| `npm run db:test` (whole chain, PGlite) | 1400/1400 in 113 files, exit 0 | 0 | 0 |
| `npm run db:test:pg` with `PG_TEST_URL` (pg-scope 8/8; material-concurrency 15/15 incl. B12, B13 with the key-share wait) | 8/8 + 15/15 | 0 | 0 |
| migration chain from an empty PostgreSQL 16 database | 105 applied (last: 101, 102, 103); re-run applies 0 | | |
| `npm run eval:check` | `GATE PASSED` | | |
| `npx next build` | exit 0 | | |

A PGlite pass is reported as PGlite; the lock behaviour (`FOR KEY SHARE`), privileges as a real role and the catalogue shape rest on the PostgreSQL runs.

Not executed: GitHub Actions on this branch (not pushed), the guided-scenario UI drive, a browser look, a managed PostgreSQL.


## 6. Known limitations

* A re-derivation still deletes and re-creates the spool rows and, with them, **steps**, coating items, ship loads and detaches reservations/issues — existing behaviour, deliberately not changed here. The override *events* survive; the step they annotate does not, and the new spool starts with no step. (The history is shown on the new spool through the drawing key, not through a step.)
* Matching a spool across derivations/revisions is by `doc_no + sheet_no + spool_no`. If an edit or a revision renumbers spools, the event is still readable (project history, its own snapshot) but a differently-numbered spool does not show it.
* `spool_id`/`activity_id` on an old event can dangle; nothing resolves them any more — the snapshot is the identity.
* The key-share lock covers the moment of writing; a spool deleted a millisecond after commit is simply deleted (that is the point).
* A superuser can still disable the triggers or TRUNCATE; the application role cannot.
* Project deletion removes the project's events.
* Not executed: GitHub Actions on this branch at the time of writing; UI drive; browser look at the new column; a managed PostgreSQL.

## 7. Files

`db/migrations/103_material_override_snapshot.sql` (new) · `lib/db/repos/piping-execution.mjs` (reader) · `app/piping/execution/page.jsx` · `lib/i18n/sections/piping.mjs` · `db/test/material-override-retention.mjs` (new) · `db/test/material-override-migration.mjs` · `db/test/material-override.mjs` · `db/test/material-concurrency.mjs` · `package.json` · `docs/audit/phase-2d-material-override-audit.md`, `phase-2d1-database-integrity.md` (superseded claims marked) · this document.

## 8. Deployment

`sudo epc backup && sudo epc update` runs migration 103 (its own transaction; if an event cannot be filled in it stops and the schema stays at 102).
