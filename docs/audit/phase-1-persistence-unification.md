# Phase 1 — Unify register, BOM, allocation and equipment persistence

Branch `fix/unify-register-persistence`, from `master` at `d5f4557`. Migration **104**.

## 1. What was inspected and what it showed

Files read: `app/api/runs/route.js`, `app/api/runs/[id]/edits/route.js`, `lib/db/repos/{review,runs,line-list,bom-allocation,iso-equipment}.mjs`, `lib/register/bom-allocation.mjs`, `lib/sheet/markup.mjs` (the equipment/accessory helpers), `app/api/bom-allocations/route.js`, `components/{SaveBar,EditPanel,WeldListEntry}.jsx`, migrations 097/098 and the tests of those modules.

### Transaction boundaries before this phase

| Path | Transaction | Wrote |
|---|---|---|
| `POST /api/runs` | one `db.transaction` (the route's) | line, run, **register** (`saveRegister`), line list, **BOM** (`saveIsoBom`, only if `payload.bom` had rows), **equipment** (`syncEquipment`, only if BOM rows *or* marks), **allocations** (`syncAllocations`, only if BOM rows) |
| `POST /api/runs/[id]/edits` → `applyCorrection` | one `db.transaction` | edit log, payload, **register** (delete welds + spools, `saveRegister`) — **nothing else** |
| `POST /api/bom-allocations` | one `db.transaction` (the route's) | `transition` (install / return / release) |

### The inconsistencies this produced

1. **A correction left the dependents stale.** Correcting `bom[…]` or `sheetMarkup…` rebuilt the register and updated the run's payload, but `iso_bom_row`, `bom_allocation` and `iso_equipment` stayed as the first save made them. The run said one thing, the BOM and ledger another.
2. **`bom` omitted and `bom: []` were the same.** Both skipped `saveIsoBom` (the guard was `Array.isArray && length`), so a BOM could never be cleared, and "no key" and "empty" were indistinguishable. The page sends `bom` only when non-empty (`WeldListEntry.jsx`), so a person emptying the table sent *nothing*.
3. **Dependents were synced under accidental conditions:** allocations only when the BOM had rows (marks removed from a sheet with no BOM rows left lines held); equipment when BOM rows *or* marks.
4. **`transition` read the allocation without a lock** and then wrote the new status: an install and a release at once both passed the status check; the history could say `reserve, install, release`.
5. **`bom_allocation_event` depended on its allocation row**: `allocation_id … ON DELETE CASCADE`, and `history()` joined the live row to say what an event was about. The default privileges of 001 also left `app_rw` able to UPDATE and DELETE events.

## 2. The shared service (`lib/db/repos/register-persistence.mjs`)

* `persistRegister(db, { … replaceRegister, syncDependents })` — optionally removes the run's welds and spools (a correction re-derives the *same* run), saves the register (`saveRegister`, weld identity from `carryFrom`), then syncs the dependents.
* `syncSheetData(db, …)` — locks the document row (`FOR UPDATE`, which also checks it is the project's), then BOM → equipment → allocations, in that order.
* `bomState(payload)` and `touchesSheetData(edits)`.
* It is **not a transaction**: it runs on the handle it is given (the caller's open transaction), never calls `db.transaction`, and throws on failure so the caller's rollback takes everything. Both `POST /api/runs` and `applyCorrection` call it; they keep what is theirs (a save creates the run and carries identity from the previous run of the drawing and fills the line list; a correction logs the edits, updates the payload and re-derives the same run).
* Permission checks stay in the routes (`RUN_EXTRACTION`, `EDIT_EXTRACTION`), unchanged; ownership of the document is checked in the service.

### The three states of `bom`

| payload | meaning | behaviour |
|---|---|---|
| `bom` absent or `null` | leave the saved BOM | not written; equipment and allocations are reconciled against the BOM on file |
| `bom: []` | explicit clear | **409 `BOM_IN_USE`** while any allocation of the revision is reserved or installed (it names the counts); otherwise rows deleted |
| `bom: [ … ]` | replace | `saveIsoBom` (one row per PT); then the usual sync: an installed line whose row is gone or smaller refuses (409), a reserved line is adjusted/released with a recorded reason |

Replace and clear are refused (**409 `BOM_LOCKED`**) when the revision has an approved run: a signed BOM changes by a new revision. (`POST /api/runs` already refuses a re-extraction over an approved revision earlier with `REVISION_ALREADY_APPROVED`; the service refuses for any caller.) `null` is read as absent — it never destroys data. Anything else that is not an array is a 400.

**Callers:** `SaveBar`/`WeldListEntry` build `data` with `bom` only when non-empty; one line is added so that a person who empties a BOM the sheet had sends `bom: []` (otherwise the new "clear" state would be unreachable from the page). `EditPanel` posts the run's payload as edited: a deleted `bom` key is "leave", `[]` is "clear". The OCR/extraction path never sends `bom: []` for a sheet with no BOM (it omits the key).

### The sheet's marks

The page sends `sheetMarkup` only when there are marks, so absent means none (this is how it already behaved whenever a BOM was present). Equipment and allocations are reconciled to the marks: planned equipment of a removed mark goes; **installed or tested equipment, an installed accessory, an installed allocation are never dropped — the save/correction is refused (409) with a message saying what to return first.**

## 3. Manual correction (`applyCorrection`)

After the register is rebuilt, if the edits touch `bom…` or `sheetMarkup…`, the dependents are re-made with the same rules a save has. Everything is in the correction's transaction; a refusal undoes the register, the edit log, the payload — the run is exactly as it was (tested). Additional guard: BOM, equipment and allocations belong to the **drawing revision**, so only the revision's current (latest, non-failed) run may change them; correcting an older run's sheet data is **409 `RUN_NOT_CURRENT`** (its geometry can still be corrected). A model error leaves no register and skips the dependents, as before. The response gains `sheetData` (what was done) only when dependents were synced.

## 4. Allocation transitions (`lib/db/repos/bom-allocation.mjs`)

* `transition` runs in a transaction (a savepoint when the route's transaction is open), reads the allocation with **`SELECT … FOR UPDATE` filtered by project and document** (ownership in the same read), and only then checks the status. The installed duplicate of the same owner and row is locked too. The reason check and the allowed-transition table are unchanged; the event is inserted in the same transaction as the status update (atomic, with reason, user, time).
* `syncAllocations` reads the lines it will change `FOR UPDATE` (ordered by id), so a save and a transition of the same sheet are taken in turn.
* The BOM-row capacity trigger is untouched.

## 5. Event history (migration 104)

* New immutable columns on `bom_allocation_event`: `owner_kind`, `owner_ref`, `owner_no`, `pt`, `unit` (NOT NULL except `owner_no`). Existing events are filled in from their allocation inside the migration; the migration stops, changing nothing, if an event's allocation cannot be read.
* The key to `bom_allocation` is dropped; `allocation_id` stays as the historical id. A `BEFORE INSERT` trigger checks the allocation exists and is of the event's project **and** drawing revision (`FOR KEY SHARE`, as a key would) and fills the snapshot itself — a writer cannot forge it. (`history()` now reads the events only.)
* Append-only: `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_rw` (the default privileges had left them) plus a trigger refusing any UPDATE.
* Kept: RLS, project and document keys, the index.

## 6. Tests

New: `db/test/register-persistence.mjs` (13, through the real route handlers), `db/test/bom-allocation-history.mjs` (5, PGlite and PostgreSQL), `db/test/bom-allocation-concurrency.mjs` (5, PostgreSQL only, in `db:test:pg`).

| Required | Where |
|---|---|
| 1 initial run, non-empty BOM | `1.` register, BOM, equipment (with an accessory-like PT use) and allocations together |
| 2 initial run, omitted BOM | `2.` |
| 3 explicit empty BOM | `3.` refused while held, cleared when free |
| 4 correction, BOM unchanged | `4.` geometry only: BOM, ledger and equipment identical; no `sheetData` |
| 5 correction that changes the BOM | `5.` BOM and ledger follow |
| 6 capacity | `6.` over capacity refused, BOM / ledger / register / payload all as before |
| 7 concurrent transitions | `bom-allocation-concurrency.mjs` C1–C4 (PostgreSQL) |
| 8 installed allocation protected | `8.` |
| 9 installed/tested equipment protected | `9.` |
| 10 history after deleting/replacing the allocation | `bom-allocation-history.mjs` |
| 11 rollback when a dependent fails | `11.` (a save and, in `6.`/`8.`/`9.`, a correction) |
| 12 revisions and historical integrity | `12.`, signed-BOM test, run-not-current test, migration-104-over-data tests |

Guards proved by reverting: the `FOR UPDATE` removed from `transition` ⇒ C1–C4 red on PostgreSQL (the history even read `reserve, install, release`).

### Results (this session, local; counts from each run's own output)

| run | passed | failed | skipped |
|---|---|---|---|
| `register-persistence.mjs` (route handlers, PGlite) | 13/13 | 0 | 0 |
| `bom-allocation-history.mjs` (PGlite) | 5/5 | 0 | 0 |
| the same two + `bom-allocation`, `iso-equipment`, `review`, `api` on real PostgreSQL 16.15 | 13/13, 5/5, 18/18, 9/9, 23/23, 27/27 | 0 | 0 |
| `bom-allocation-concurrency.mjs` (PostgreSQL, `PG_TEST_URL`) | 5/5 | 0 | 0 |
| `npm run db:test` (whole chain, PGlite) | 1418/1418 in 115 files, exit 0 | 0 | 0 |
| `npm run db:test:pg` (pg-scope 8/8; material-concurrency 15/15; bom-allocation-concurrency 5/5) | 8/8 + 15/15 + 5/5 | 0 | 0 |
| migration chain from an empty PostgreSQL 16 database | 106 applied (last: 102, 103, 104); re-run applies 0 | | |
| `npm run eval:check` | `GATE PASSED` | | |
| `npx next build` | exit 0 | | |

Two failures were met on the way and fixed, not skipped: a Phase 2d.1 migration test that asserted the exact list of migrations applied after 103 (now "includes 103"), and a Phase 2d.2 retention test that corrected a run that is no longer its revision's current one with a BOM edit (now a geometry edit, since sheet data of a non-current run is refused by design). An earlier `db:test` run stopped at the second one, so the files after it were re-run in the full pass above.

Not executed: GitHub Actions on this branch (not pushed), the browser/UI drives (including the SaveBar → `bom: []` path in a real page), a managed PostgreSQL.


## 7. Remaining risks and limits

* `null` for `bom` is treated as absent (never destroys); a client that means "none" must send `[]`.
* A clear is refused while *reserved* lines exist, even though a replace would release reserved lines: the brief's reading ("active or installed") was followed; release them first (`POST /api/bom-allocations`).
* Marks are "absent means none", as the page's own behaviour; an API client that omits `sheetMarkup` for a revision with equipment will see it removed (planned) or refused (installed/tested).
* The approved-BOM rule is per drawing revision; a new revision (new document) has its own BOM and ledger, as before. There is still no workflow that *carries* a BOM or ledger to the next revision.
* Events are removed with their drawing revision (document key) or project; deleting a revision's `bom_allocation` row alone leaves them whole.
* `syncEquipment` accessories are not re-validated against a changed BOM here (the ledger's `verifyLedger` is what refuses a PT that is gone while held).
* Not executed: GitHub Actions on this branch at the time of writing; the browser/UI drives; a managed PostgreSQL; production data.

## 8. Files

`lib/db/repos/register-persistence.mjs` (new) · `lib/db/repos/review.mjs` · `app/api/runs/route.js` · `lib/db/repos/bom-allocation.mjs` · `components/WeldListEntry.jsx` · `db/migrations/104_bom_allocation_event_snapshot.sql` (new) · `db/test/{register-persistence,bom-allocation-history,bom-allocation-concurrency}.mjs` (new) · `package.json` · this document.

## 9. Deployment

`sudo epc backup && sudo epc update` (migration 104; its own transaction — if an event cannot be filled in it stops and the schema stays at 103).
