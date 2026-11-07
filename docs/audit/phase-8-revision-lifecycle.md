# Phase 8 — Revision Lifecycle & Controlled Carry-Forward · STEP 0 audit

Base: `master` d9a052d. Everything below was read in the code before any change.

## 1. What exists

| Question | Finding (file) |
|---|---|
| Is a new revision its own Document? | **Yes.** `document` row per (project, doc_no, revision, sheet_no) — `UNIQUE` (001_core.sql). A new revision is a new `document`; its runs (`extraction_run`) and everything under it (BOM, equipment, allocations, marks) belong to that document. Created by `POST /api/documents` → `registerDocument`. |
| Where is old↔new link kept? | Only `document.superseded_by` — a **forward** pointer set by `supersedePrevious` on every older revision of the same (doc_no, sheet) to the **newest** upload (not to its direct successor). There is **no parent / source pointer**, no change description, no chain. Order of a chain can only be guessed from `created_at`. |
| Approval / lock | `extraction_run.status` (`extracted/approved/superseded/failed`), state machine `lib/platform/workflow.mjs` (`assertEditable`, `RUN_LOCKED`), DB trigger on `extraction_run`; `approvedRunFor`; `POST /api/runs` refuses with `REVISION_ALREADY_APPROVED`; BOM locked with the signed run (`BOM_LOCKED`). |
| What transfers today | (a) legacy `weld.weld_uid` (NDT, ITR, welder records) via `saveRegister({carryFrom})` + `matchRegisters` **by weld number/position** (`lib/register/match.mjs`) — the old register identity, separate from the payload `uid`; (b) nothing else. Payload marks/rows: "a new revision is a new document: its marks are new marks" (`app/api/runs/route.js`); `sheet_mark_identity.uid` is PRIMARY KEY and registered to ONE document, so a uid can **never** be reused by another revision (migration 105). BOM, equipment, accessories, component PTs, spools, supports are re-entered by hand in the new revision. |
| Comparison | **Exists, narrow:** `lib/register/diff.mjs` `diffRegisters` + `lib/db/repos/revisions.mjs` `compareRuns/compareWithPrevious` + `GET /api/runs/[id]/diff` (tests `db/test/revisions.mjs`) compare two **derived weld registers** (DB `weld` rows, matched by weld number + geometry — i.e. a *heuristic* identity) and report the spools a change lands in by fabrication stage (`spoolImpact`). It is **kept unchanged**. It does not compare the payload (typed rows, sheet marks), BOM, equipment, spools, supports or metadata, and has no UI. (An earlier draft of this audit missed the route/repo; the new lifecycle repo therefore lives in its own file `lib/db/repos/revision-lifecycle.mjs`, not in `revisions.mjs`.) |
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
* **Server** `lib/db/repos/revision-lifecycle.mjs` (the existing `revisions.mjs` weld-register diff is untouched): lineage (create/link/chain, recursive CTE, fixed queries), compare (loads both latest runs, A's ledger/equipment, mappings), `carryForward` (one transaction: lock target document, check target `baseHash` and source hash → `STALE_RUN`, re-plan on the server from stored state — the client's selection is only a list of keys —, build the corrected target payload, call `applyCorrection` (so permission/locks/sync/edit-log are the existing ones), then write op + map rows; same `requestKey` → returns the recorded op, creates nothing).
* **Carry rules** (details in §6 of the final doc): only descriptive fields into **empty** fields of the target; never status / installed / tested / allocations / history; PT only if valid in the target BOM; equipment weld links only through explicit mappings; anything else listed, not moved.
* **Validation**: new `REV_*` codes in the Phase 7 catalog fed by `saved.lineage`; no second engine.
* **API**: `GET/POST /api/revisions`, `GET /api/revisions/compare`, `POST /api/revisions/carry`. **UI**: a «نسخه‌ها» tab of the existing workspace (timeline, compare, carry-forward).

## 4. Revision lineage (as built)
* `document.parent_document_id` (write-once; DB trigger: same project, same `doc_no` and sheet, not itself; `UNIQUE` per parent → a line, not a tree) + `document.change_note`. `superseded_by` and registration are unchanged. Created by `POST /api/revisions {action:"create"}` (a new `document` row for the same sheet, linked to its source; registering the same revision again is idempotent; a revision that exists under another source is refused) or `{action:"link"}` for an already-registered revision (cycle / foreign sheet / second child / re-link refused). The file of the new revision is attached by the normal upload (same drawing no. and revision attaches to the `none://` row — existing behaviour).
* `GET /api/revisions?projectId&documentId` returns the chain oldest → newest with status (`approved` / `extracted` / `no-run`), approval, creator, source, change note, carry operations; revisions with no source are reported as unlinked, never guessed into the chain.
* The status vocabulary is the existing `run_status`; no new status or column duplicates it.

## 5. Comparison rules (`lib/revision/revision-diff.mjs`, pure)
* Identity: explicit stored mapping only. Same unique printed number on both sides = `candidate` (proposal, needs confirmation); several = `ambiguous`; geometry never matches. A target uid can never equal a source uid (105), so unmapped = unlinked.
* Compared: metadata (`meta`, `lineData`), welds (location, joint type, NPS, spool, schedule, material, WPS, tie-in, components), spool / support / equipment attributes (equipment: tag, type, BOM PT, accessories, weld references, status shown only), BOM per PT (description, quantity, unit, size, material, group), mark position as a separate **geometry** category, number changes as **identity**, and the **allocation impact** per PT (what the source ledger held — reported as history that stays with the source).
* The existing weld-register diff (`GET /api/runs/[id]/diff`) is unchanged and complementary (built-spool impact).

## 6. Carry-forward rules (`carryForward`, `POST /api/revisions/carry`)
1. Only on an explicit request; the server plans again from stored state and the request only chooses among what the plan allows (unknown change → 409 `UNKNOWN_CHANGE`).
2. Source is never written. The target must be the revision made from the source (`INVALID_LINEAGE`), unapproved (`RUN_LOCKED`), and both runs must be the ones compared (`STALE_SOURCE`, `STALE_RUN`).
3. Only descriptive fields (`CARRY_FIELDS`), only into **empty** target fields; a differing target value is never overwritten. **Never carried:** status (installed/tested/planned…), allocations and their events, approvals, history, geometry, numbers, location/kind/size of a weld.
4. PT references only if the PT exists in the target BOM; a PT whose row changed needs the person's explicit field choice (`needs_decision`); accessories split into the valid subset and the blocked rest.
5. An equipment's weld links move only as the **mapped target uid** of an explicitly mapped weld.
6. A candidate/ambiguous pair becomes a mapping only by the person's validated choice (must be the offered candidate; a uid maps once).
7. Applied through the existing `applyCorrection` in the same transaction (permissions-of-state, edit log, BOM/equipment/allocation re-sync with the target's OWN demand), then `revision_carry_op` + `revision_carry_map` rows. Same `requestKey` → the recorded result, nothing new. Any failure rolls the whole operation back.

## 7. API / database changes
* `GET/POST /api/revisions`, `POST /api/revisions/carry` (piping area; `VIEW_PROJECT` / `UPLOAD_DOCUMENT` / `EDIT_EXTRACTION`). `GET /api/validation` now also reports lineage findings. No change to `/api/runs`, `/api/documents`, approvals.
* **Migration 106** (additive, not run anywhere but the test databases): `document.parent_document_id`, `document.change_note`, trigger `document_parent_check`, partial unique index, tables `revision_carry_op` and `revision_carry_map` (RLS by project, append-only triggers, no UPDATE/DELETE grant). **It must be run on the server** before this version is deployed.

## 8. Validation integration
Phase 7 engine, new codes: `REV_NO_SOURCE`, `REV_BAD_LINEAGE`, `REV_DUP_RELATION`, `REV_UNRESOLVED_MAP`, `REV_AMBIGUOUS_MAP`, `REV_BAD_PT_MAP`, `REV_HIST_DEMAND`, `REV_STALE_SOURCE`, `REV_INCOMPLETE_CARRY` (existing: `E_WELD_DANGLING`, `REV_APPROVED`, `A_*`). Input: `saved.lineage` from `lineageFacts` (fixed queries).

## 9. UI
«نسخه‌ها» tab of the typed workspace (`components/RevisionPanel.jsx`, state in `lib/client/revision-center.mjs`, held by the workspace so tab switches keep selection/filters/decisions): timeline (revision, status, dates, creator, approval, source, change note), create revision, source selector, comparison table with kind/category/search filters, detail (previous/new values, old/new UID, dependencies, reason, carry state), candidate confirmation, ambiguous resolution (no pre-selection), per-field carry checkboxes with reasons for blocked fields, hold/exclude, final summary dialog, link to the validation tab. Selecting a change selects its mark on the drawing and vice versa. After a carry the saved target is reopened (`key` includes the run's payload hash).

## 10. Deferred / risks
* The Revisions tab exists in the typed workspace with a sheet (like the Validation tab); the model route has none.
* A revision created in the UI has no register until its data is saved (a new list with the same drawing no. and revision, or upload); the tab says so.
* Equipment/weld **identity across revisions** is explicit and manual — by design; large re-issues need many confirmations (no bulk "confirm all unique numbers" on purpose).
* Carry-forward only fills empty fields; overwriting a differing value is intentionally not offered.
* Existing legacy `weld.weld_uid` carry (by number/geometry in `saveRegister`) is untouched and still heuristic; it is a different identity from the payload uid.
* Disk of the build container was nearly full during the work; scratch directories were cleaned selectively.

## 11. Results (this branch)
* `db/test/revision-lifecycle.mjs`: 23/23 (9 pure, 14 route-level) on PGlite and real PostgreSQL. Guards proven by reverting: source-hash check (S8 fails), chain/lineage check (S14 fails); the approved-target lock is double-held (revert of this repo's check still refused by `applyCorrection`'s `assertEditable`, same `RUN_LOCKED`).
* Existing `db/test/revisions.mjs` (weld-register diff route) 15/15; `engineering-validation` 34/34; `weld-bom-equipment` 28/28 on both PGlite and PG.
* `npm run db:test`: whole chain, 123 files reporting, 0 FAIL. `npm run db:test:pg`: 8/8, 15/15, 5/5, 3/3. `npm run eval:check`: GATE PASSED. `npx next build`: compiled.
* `db/test/migrations.mjs` is a PGlite test (it prints no count under `DATABASE_URL`); it passes 10/10 on PGlite with migration 106 applied.
* Browser drive `tools/drive-revision-lifecycle.mjs`: 46 checks, all true, no page errors; screenshots in `docs/audit/phase-8-shots/`.
* The Vercel checks of the PR are read from GitHub after the push.
