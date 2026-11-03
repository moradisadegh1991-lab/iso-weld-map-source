# Phase 1.1 + Phase 2 audit — material lifecycle and concurrency (2026-11-03)

Branch `audit/phase-2-material-lifecycle`. Built on `docs/audit/phase-1-db-security.md`. What is claimed here was run;
what was only read is marked **(read)**; what was not examined is under "Remaining gaps".

## 1. Architecture and data flow (as it is)

```
isometric sheet ──register──▶ spool_material (per spool: stock code, qty, uom)          lib/piping/spool-bom.mjs, spool-material.mjs
                                   │ stock code = material_item.code (matched by upper(code))
MTO (manual) ──setRequirement──▶ material_requirement (item, qty, source)               warehouse.mjs  [not fed by the sheet]
                                   ▼
MR ▸ RFQ ▸ bid ▸ award ▸ PO ▸ po_line (item | tag, qty, uom) ──createShipment──▶ shipment ▸ shipment_line   procurement.mjs
                                   │ FAT release required for tagged equipment
                      receiveAgainstPo ▼ (qty ≤ ordered − received)
              material_lot (received) ──inspectLot (MIR)──▶ qty_accepted/rejected ──reviewMtc──▶ mtc_status
                                   │ issuable = accepted ∧ (heat ∧ MTC accepted for traceable categories)
          reserve / reserveSpoolMaterial ▼  material_reservation (item | lot, destination)       reserve.mjs
          recordMovement (issue/return) ──▶ material_movement  (immutable ledger; count_gain/count_loss from stock counts)
          workfront ◀── spoolMaterial() state: matched / reserved / issued / short
```

Tables: `material_item`, `material_lot`, `material_movement`, `material_requirement`, `material_reservation`,
`stock_count`, `stock_count_line`, `spool_material`, `po_line`, `shipment`, `shipment_line`. Row-level security on all of
them (`project_isolation`).

## 2. Confirmed defects (each reproduced on PostgreSQL 16 before the fix)

| # | Defect | Reproduction (old code) | Now |
|---|---|---|---|
| B1 | `recordMovement` read the balance, then inserted, with no lock and no transaction (its own comment said the opposite) | 8 issues of 30 at once on a lot of 100 → 5 accepted, **150 issued** | exactly 3, 90 issued |
| B2 | `reserve` computed free stock, then inserted | 6 reservations of 40 on 100 free → 5 accepted, **200 promised** (3 / 120 on another run) | exactly 2, 80 |
| B2b | issue and reserve of the same stock raced | together exceeded stock | at most one of 70+70 on 100 |
| B3 | `reserveSpoolMaterial` reserved line by line, no transaction | failure on line 3 left 2 reservations (PGlite too) | none left |
| B4 | `receiveAgainstPo` checked then wrote, and the lot's link to the PO line was a second statement | 6 receipts of 40 on 100 → 6 accepted, **240 received**; a failure left an unlinked lot | exactly 2, every lot linked |
| B5 | `createShipment` checked shipped quantity, then inserted header and lines separately | 6 shipments of 40 on 100 → 6 accepted; a failure left a header with no lines | exactly 2, each with its lines |
| B6 | an issue validated against the lot, an MTC rejection or MIR correction committed, the issue then wrote | issue written after the rejection committed (gated reproduction) | the issue holds the lot, the rejection waits and lands after it (a late rejection → recall), or the issue is refused |
| B7 | `decideCountLine` read the book balance, then inserted the adjustment, and a second decision on one line could repeat it | **(read)** same pattern as B1 | count line, item and lot locked; transaction |
| PGlite | a transaction opened inside another issued a second `BEGIN`; the inner `COMMIT` closed the outer early | the all-or-nothing tests could not pass | inner = `SAVEPOINT` (as on node-postgres) |
| Areas | the table's area list (15) was shorter than the code's (18): `contracts`, `finance`, `hr` could not be stored, so an area-restricted member could never be given those desks | `UPDATE project_member SET areas = '{contracts}'` → `member_areas_known` | migration 099 widens the check |

**Not a defect (Phase 1.1 A1):** concurrent duplicate field operations: six at once → 1 applied, 5 `duplicate` with the same
stored outcome, 0 retry, 1 `tag_activity` row. The test now asserts exactly that (before it accepted `retry`).

## 3. Mechanism

`lib/db/lock.mjs`: inside `db.transaction`, `SELECT … FOR UPDATE` on the thing being spent, **then** the balance is read.
Order is always item → lot, PO lines in id order, a count line first for a count decision: operations on the same rows
queue instead of deadlocking. `recordMovement`, `inspectLot`, `reviewMtc` lock item+lot; `reserve`, `releaseReservation`
lock the item; `reserveSpoolMaterial` locks all its items up front; `receiveAgainstPo` and `createShipment` lock the PO
lines. Callers are unchanged (the transaction is inside the repository functions). The movement ledger is still
insert-only; the recall list (`destinations`) is unchanged.

## 4. Area review of the 12 routes (Phase 1.1 A2)

- `/api/contractors` → area **contracts** (the contractor registry; needs `MANAGE_MEMBERS` already).
- `/api/records` → per record kind on DELETE (`areasForRecord`): contractor, contract-package → contracts; hse-* → hse;
  precom-template, guarantee, perf-test → completions; control-account → controls; mdr-document → documents;
  coating-system → coating; weld-joint → structural **or** equipment.
- Left without an area **on purpose** (`REVIEWED_ROUTES`, each with its reason): `assumptions`, `changes`,
  `contract-reports`, `daily-reports`, `eps`, `eps/activities`, `eps/planning`, `reference`, `subsystems`, `work`. Their work
  crosses disciplines or is a workflow or administrator's action; an area would shut out the people the workflow names
  (a contractor member working in `piping` could not file a report). A test pins that a member of any one area still reaches them.

## 5. Tests and results

| Command | Result |
|---|---|
| `npm run db:test` (PGlite, whole chain) | exit 0, 0 `FAIL` |
| `npm run eval:check` | `GATE PASSED` |
| `npx next build` | no errors |
| `PG_TEST_URL=… npm run db:test:pg` (PostgreSQL 16.15, local) | pg-scope **8/8**, material-concurrency **8/8** |
| material-concurrency, three more runs, fresh database each | 8/8, 8/8, 8/8 (no flake seen) |
| the same material-concurrency tests on the **code before the fix** | **1/8** — only the cross-project test passed; B1, B2, B2b, B4, B5, B6, B6b failed (red first) |
| `db/test/material-atomic.mjs` (PGlite **and** PostgreSQL) | 3/3; **0/3 before the fix** (a reservation, a shipment header, an unlinked lot survived the failure) |
| every `db/test/*.mjs` file, one fresh PostgreSQL 16 database each, `DATABASE_URL` set (108 files) | 105 pass in full; `run` fails by design (it asserts no `DATABASE_URL`); `migrations` is written for PGlite and failed identically on the old client (Phase 1); `pg-scope` and `material-concurrency` print SKIPPED in this loop (no `PG_TEST_URL`) and were run on their own, above |
| area guards: `users.mjs` (+3 tests: reviewed routes, records per kind, every area storable) | 15/15; the area-storable test failed before migration 099 (`member_areas_known`) |
| CI | `pg-scope` job now runs both PostgreSQL files |

**NOT RUN:** a managed or remote PostgreSQL; load; the 15-step end-to-end scenario (C5); VDRL / expediting / BOM-revision
behaviour. Tests that need a real server print SKIPPED without `PG_TEST_URL` and are never counted as passed.

## 6. Follow-up (Phase 2b): the three findings, the award, VDRL, forecasts, and the end-to-end scenario

All with a failing test first; PGlite and PostgreSQL 16.

- **C1 MTO revisions** (`lib/warehouse/mto.mjs`): the latest revision of each MTO series is the requirement; earlier
  ones are superseded — shown in `supersededSources`, no longer counted. «Piping MTO rev 1» and «rev 2» replace each other;
  «Piping MTO» and «Civil MTO» add; a source with no revision («Site request 17») is its own series. Read-time only —
  nothing is deleted or migrated. Letters order before numbers (A < B < 0 < 1), 10 after 9. Before: 220 instead of 120.
- **C2 receipt vs shipment** (`receiveProblems`): once shipments are recorded for a line, received ≤ shipped (and ≤ ordered).
  A line with no shipment recorded is received against the order alone, as before. An existing unit test whose fixture
  was 6 shipped / 6 received had pinned only the order ceiling; its fixture was aligned.
- **C4 spool step without issued material** (`recordSpoolActivity`): **warns, does not block** — it is recorded, and the
  answer carries `materialWarnings` (additive; also in the offline sync result) when a material-consuming step
  (`fit_up`, `erected`) is done with the spool's list not all issued. A spool with no list says nothing. Blocking would stop
  legitimate site work (material reaches a spool in ways the platform may not know); changing warn → block is one line if
  the owner wants it.
- **C2 award** (`awardMr`): the PO, its lines, the award record and the MR's closing are one transaction, the MR locked.
  Before: a failure left a PO without its lines; four awards at once placed **four POs**. Now exactly one (B8).
- **VDRL** (`submitDoc`, `returnDoc`): the document is locked. Before: four submissions at once recorded **3**; four review
  codes at once **all succeeded** (the last overwrote) — now one each (B9, B9b).
- **Expediting** (`setForecast`): history row and the line's date in one transaction, the PO line locked. Before: the line's
  date could differ from the latest recorded forecast, and a failure left a history row for a date the line never took (B10).
- **FAT vs shipment (B11): not a defect.** The FAT insert's foreign key already locks the PO line the shipment holds; kept
  as a guard test.
- **C5 scenario** (`db/test/material-lifecycle.mjs`, PGlite and PostgreSQL): register → spool material → items → MTO
  (rev 0 replaced by rev 1) → MR → bid → award → PO → partial shipment → refused over-receipt → partial receipt → MIR →
  MTC → spool reservation → issue filling it → return re-opening the spool's line → stock, reservation and shortage
  checked against arithmetic done in the test → MTC rejected after issue (recall names the spool and the net quantity;
  no new issue) → another project sees nothing.

## 6b. Still open (read, for the owner)

- **Receipt without any shipment** is still allowed (collected by the site, bought locally); only a shipment-backed line is capped.
- **Arrival** (`arrived_on`) is not required before receipt; the cap is the quantity *shipped*.
- **Slow work inside a scope holds a pooled connection** (`DATABASE_POOL_MAX`).

## 7. Remaining gaps

Not run: any load test, or a managed/remote PostgreSQL. VDRL/expediting were audited for the races and atomicity above,
not for report layouts or the overdue arithmetic (already unit-tested in `procurement.mjs`).

## 8. Migration and deployment

- **Migration 099** (`db/migrations/099_member_areas_complete.sql`): widens `member_areas_known` from 15 to 18 areas. No
  row changes, nothing refused that was accepted. Run it on the server (`sudo epc update` applies pending migrations).
- **VPS (PGlite):** `sudo epc backup && sudo epc update`. The row locks are inert there (one connection) but the
  transactions are real: `reserveSpoolMaterial`, `createShipment` and `receiveAgainstPo` are now atomic on PGlite too.
- **`DATABASE_URL` deployments:** as Phase 1 (`DATABASE_POOL_MAX`); locks take effect on a real server.
