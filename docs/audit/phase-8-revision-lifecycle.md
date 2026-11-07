# Phase 8 — Revision Lifecycle & Controlled Carry-Forward · STEP 0 audit

Base: `master` d9a052d. Everything below was read in the code before any change.

## 1. What exists

| Question | Finding (file) |
|---|---|
| Is a new revision its own Document? | **Yes.** `document` row per (project, doc_no, revision, sheet_no) — `UNIQUE` (001_core.sql). A new revision is a new `document`; its runs (`extraction_run`) and everything under it (BOM, equipment, allocations, marks) belong to that document. Created by `POST /api/documents` → `registerDocument`. |
| Where is old↔new link kept? | Only `document.superseded_by` — a **forward** pointer set by `supersedePrevious` on every older revision of the same (doc_no, sheet) to the **newest** upload (not to its direct successor). There is **no parent / source pointer**, no change description, no chain. Order of a chain can only be guessed from `created_at`. |
| Approval / lock | `extraction_run.status` (`extracted/approved/superseded/failed`), state machine `lib/platform/workflow.mjs` (`assertEditable`, `RUN_LOCKED`), DB trigger on `extraction_run`; `approvedRunFor`; `POST /api/runs` refuses with `REVISION_ALREADY_APPROVED`; BOM locked with the signed run (`BOM_LOCKED`). |
| What transfers today | (a) legacy `weld.weld_uid` (NDT, ITR, welder records) via `saveRegister({carryFrom})` + `matchRegisters` **by weld number/position** (`lib/register/match.mjs`) — the old register identity, separate from the payload `uid`; (b) nothing else. Payload marks/rows: "a new revision is a new document: its marks are new marks" (`app/api/runs/route.js`); `sheet_mark_identity.uid` is PRIMARY KEY and registered to ONE document, so a uid can **never** be reused by another revision (migration 105). BOM, equipment, accessories, component PTs, spools, supports are re-entered by hand in the new revision. |
| Comparison | `lib/register/diff.mjs` `diffRegisters` compares two **weld registers** (DB `weld` rows, number+geometry matching) and `spoolImpact`. No comparison of the payload (typed rows, sheet marks), BOM, equipment, spools, supports or metadata; no UI; no route that exposes it. |
| Carry-forward in API or UI? | API only for `weld_uid` (inside the run save). No user-controlled step, no preview, no per-item decision. |
| Installed/allocation limits | `bom_allocation` is per `document_id`; events append-only with snapshot (104); a save never releases an installed line; `BOM_IN_USE`, `A_ROW_GONE` etc. Nothing links allocations across revisions, and nothing creates demand for a new revision from an old one (a new revision's ledger is made from its own marks). Equipment status (`iso_equipment.status`, accessories) per document, never copied. |
| Reusable pieces | `projectWelds`/`effectiveItems`, `equipmentWelds`, `ledgerDemands`, `validate` (Phase 7, extensible with `saved.*` inputs), `applyCorrection` (transaction-safe, `STALE_RUN` via `baseHash`, `assertEditable`, re-syncs BOM/equipment/allocations, edit log), `payloadHash`, `useValidationCenter`, `ValidationPanel` pattern, route test harness, Playwright drive lib. |

## 2. Gaps (the only things Phase 8 adds)
1. No parent/source revision, change description, or chain → **cannot be derived from existing columns** (the existing pointer is many-to-newest). → additive migration.
2. No identity mapping old uid → new uid. Registry forbids reuse, so a mapping **must be stored** to be "valid and traceable" → additive table.
3. No payload-level revision diff (welds/marks/BOM/equipment/spool/support/metadata).
4. No user-controlled carry-forward; no record of what was carried, by whom, against which source state.
5. Validation does not know revisions (missing parent, bad lineage, ambiguous mapping…).
6. No UI for timeline/compare/carry.

## 3. Architecture (builds on, does not replace)
* **Migration 106 (additive only).** `document.parent_document_id` (+ `change_note`), `revision_carry_op` (one row per applied carry-forward: source/target documents, hashes of both runs it was made against, request key = idempotency, user, summary) and `revision_carry_map` (op, class, `from_uid`, `to_uid`, decision), RLS like the other project tables, triggers: parent must be the same project/doc_no/sheet and not itself; parent is write-once; map rows are append-only. One child per parent (`UNIQUE(parent_document_id)`) keeps the chain linear and makes "duplicate revision relationship" impossible in data. `superseded_by`, 104, 105 and the run/approval triggers are untouched.
* **Pure engine** `lib/revision/revision-diff.mjs`: payload A × payload B (+ A's saved ledger/equipment, + stored mappings) → per-category changes. **Identity order:** explicit stored mapping → *candidate* only (never a match) when the printed number is unique on both sides → `ambiguous` when several → added / removed. Geometry is never identity. A candidate becomes a pair only by an explicit user confirmation, which is stored as a mapping.
* **Server** `lib/db/repos/revisions.mjs`: lineage (create/link/chain, recursive CTE, fixed queries), compare (loads both latest runs, A's ledger/equipment, mappings), `carryForward` (one transaction: lock target document, check target `baseHash` and source hash → `STALE_RUN`, re-plan on the server from stored state — the client's selection is only a list of keys —, build the corrected target payload, call `applyCorrection` (so permission/locks/sync/edit-log are the existing ones), then write op + map rows; same `requestKey` → returns the recorded op, creates nothing).
* **Carry rules** (details in §6 of the final doc): only descriptive fields into **empty** fields of the target; never status / installed / tested / allocations / history; PT only if valid in the target BOM; equipment weld links only through explicit mappings; anything else listed, not moved.
* **Validation**: new `REV_*` codes in the Phase 7 catalog fed by `saved.lineage`; no second engine.
* **API**: `GET/POST /api/revisions`, `GET /api/revisions/compare`, `POST /api/revisions/carry`. **UI**: a «نسخه‌ها» tab of the existing workspace (timeline, compare, carry-forward).
