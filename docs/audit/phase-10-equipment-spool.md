# Phase 10 — Equipment–Spool identity and referential integrity

Baseline: master `45a8a4d` (Phases 1–9). Branch `feat/equipment-spool-identity-guards`. No migration.

## 1. Audit (Step 0): where printed numbers connected things

| # | Where | Before | Now |
|---|---|---|---|
| 1 | `equipment.attrs.spool` (`lib/sheet/markup.mjs` `ATTRS`, MarkForm, EquipmentTable) | printed number only | `attrs.spoolUid` is the relationship; `spool` is its label (refreshed) |
| 2 | `validate()` `SP_EQUIPMENT_UNKNOWN` (`lib/engineering/validation.mjs`) | `spools.some(no === a.spool)` | `resolveRef` (uid first; legacy only if unique) → `E_SPOOL_DANGLING / E_SPOOL_AMBIGUOUS / SP_EQUIPMENT_UNKNOWN` |
| 3 | `equipmentChecks()` (markup.mjs) | printed | uid first |
| 4 | `dependents()` of a spool (deletion preview) | welds + cuts (Phase 9), equipment missing | + equipment (installed said); says the server decides |
| 5 | Spool deletion | UI preview only; a save that dropped the spool mark was accepted, leaving dangling uids | **server guard** (`lib/register/spool-guard.mjs`), 409 `SPOOL_IN_USE` |
| 6 | `endSpools()` consumer in CutForm | spool chosen with `spools.find(s => s.no === es[0])` (printed number; two spools sharing a number collapse) | `endSpoolMarks()` by identity; `endSpools()` kept for old callers |
| 7 | `iso_equipment.spool` column (migration 098) | text snapshot of the printed number | unchanged (a label copy, no FK, no behaviour rests on it) |
| 8 | `MarkTables` «welds of a spool» column | by printed number | by `spoolUid` (a printed number only for a weld with no uid and only when one spool has it) + equipment |
| 9 | Revision carry `CARRY_FIELDS.weld/equipment.spool` (Phase 8) | printed label copied | uid through the explicit spool mapping |
| 10 | `spoolChecks()` («a spool a weld names has its oval…», markup.mjs) | printed | **unchanged, advisory only**: labels are kept in sync from the uids, so it agrees; see §9 |
| 11 | **Found by the browser drive:** the mark normalizer (`ATTR_KEYS`) silently dropped `attrs.spoolUid` of equipment and of sheet weld marks on load/save | — | `spoolUid` added to `ATTR_SNAPSHOTS` (not a form field); regression test E3b |

Compatibility: payloads without `spoolUid` keep working (legacy label → uid on save only when unique); `iso_equipment`, BOM allocation, `RUN_LOCKED`, authorization, installed/tested protection are untouched.

## 2. Equipment-to-spool contract

* `equipment.attrs.spoolUid` — authoritative; must name a `spool` mark of the same revision (validated: dangling → `E_SPOOL_DANGLING`).
* `equipment.attrs.spool` — label; refreshed from the spool whenever it is renumbered (page while editing, `settleWeldSpools` on save).
* Moving = uid + label together (`assignWeldSpool`); other attributes untouched. Clearing is explicit («— بدون اسپول»).
* Legacy label → uid only if exactly one spool has the number; several → `E_SPOOL_AMBIGUOUS` (nothing set); none → `SP_EQUIPMENT_UNKNOWN` (the existing code); a dangling uid is kept and shown, never re-pointed by its old number (test E2/S7; reverting that rule fails both).
* Reuses `isUid/newUid/resolveRef/indexItems`; no registry.

## 3. Deletion protection (authoritative)

`removedSpools(previous, next)` = spools (by uid) the stored marks had and the incoming marks lack. `assertSpoolsRemovable` runs inside `prepareSheetPayload` — i.e. inside the transaction of **both** save paths (`POST /api/runs`: document locked; `POST /api/runs/[id]/edits`: run locked and `baseHash` checked first → `STALE_RUN`) — on the state about to be stored. For each removed spool it recomputes the dependents from that state: typed weld rows, sheet weld marks (incl. unlinked ones), cut pieces, equipment (all by `spoolUid`), with the register's installed/tested status. Any dependent → **409 `SPOOL_IN_USE`** with `details.spools[].dependents[] = {type, uid, no, via, status?, locked?}`; nothing is stored, detached or re-pointed. The person moves/removes the references (the form, the table), then the same deletion is accepted. The UI preview (`dependents()`, `ConfirmDialog`) is advice and says so. `GET /api/validation?spoolUid=` returns the same dependency list from the persisted register. `errorResponse` now forwards `error.details` (additive).

Concurrency: each request is self-consistent and serialized by the document/run lock; test S8 runs a deletion and a new reference concurrently and ends with no dangling reference. Not weakened: `RUN_LOCKED`, authorization, allocation, equipment/accessory installed refusals.

## 4. Validation Center (no second engine)

Added to `lib/engineering/validation.mjs` (each with stable id, entity uid/type, revision, severity, explanation, suggested action; navigation through the existing `openFinding`): `E_SPOOL_DANGLING` (error), `E_SPOOL_AMBIGUOUS` (warning), `SP_EQUIPMENT_REFERENCE` (equipment's spool ≠ its welds' spool), `WELD_SPOOL_REFERENCE` (info: stale label; also for equipment), `SP_DELETE_DEPENDENCY` (error, **blocking**: a draft that removed a still-named spool — the server would refuse it; computed from `previous` = the saved payload). Reused: `SP_EQUIPMENT_UNKNOWN` (= the requested `E_SPOOL_UNRESOLVED`), `WELD_SPOOL_DANGLING/AMBIGUOUS` (Phase 9).

## 5. UI

Equipment form: spool selector by uid (number + short uid + full uid, states legacy/ambiguous/unresolved/dangling shown, explicit clear). Equipment table: label + short uid, dangling mark, button to the spool. Spool table: welds by uid + equipment. SpoolDetail: equipment (tag, type, status, connected welds as buttons, navigate). `CutForm`: spool preselected from the two end welds' spool **uid**; two different spools or an ambiguous/unknown one → not guessed; an auto-filled spool is withdrawn when the ends later disagree, a spool the person picked is never touched. The existing workspace is extended; nothing new was added.

## 6. Revisions

Carry of `spool` (weld and equipment): source spool uid → explicit spool mapping → the **target's** uid (+ its label); `NO_MAPPED_SPOOL`, `SPOOL_NOT_IN_TARGET`, `TARGET_HAS_VALUE` (target's own relationship preserved); status/history never carried; a source uid never appears in the target (test S9). Comparison: a spool whose number changed but whose relationship (through the mapping) did not is not a field change; a different mapped spool is `rel:spool:<uid>` (weld or equipment). Phase 8 contract unchanged.

## 7. Migration decision

None. Everything is additive JSON in the payload and pure code. `iso_equipment.spool` stays a label. Nothing was run on production; **migration 106's production status remains unverified and separate.**

## 8. Verification

`db/test/equipment-spool.mjs` (21 tests; PGlite and real PostgreSQL): identity, renumbering, reassignment, legacy unique / duplicate / dangling, deletion dependencies, installed protection, authoritative read, stale edit, concurrency, carry with mapped spool uid, target isolation, CutForm selection, normalizer regression. Guards proven by reverting: server guard off → S3–S5 fail; normalizer drops `spoolUid` → E3b; dangling falls back to number → E2, S7; carry copies source uid → R1, S9. Browser drive `tools/drive-equipment-spool.mjs` (26 checks, real PDF, dark/light/phone; shots in `phase-10-shots/`); Phase 9 drive re-run. Full-suite results on the final SHA are in the PR.

## 9. Remaining limitations and risks

* `spoolChecks()` («oval without welds» etc.) is still printed-number based and advisory; labels are kept in sync so it agrees, but two spools sharing a number can make it noisy.
* A weld/cut/equipment with a legacy label only (no uid) is not a dependency for the deletion guard (it cannot be proven); validation reports its unresolved label.
* The guard decides from the incoming payload; an API client that deletes a spool and keeps references in a *different* revision is out of scope (uids are per revision).
* `iso_equipment.spool` and the typed register's `weld.spool` DB column are labels and can lag one save behind a renumbering made through the API only.
* No change to extraction, geometry, BOM capacity rules, authorization, or the revision lifecycle.
