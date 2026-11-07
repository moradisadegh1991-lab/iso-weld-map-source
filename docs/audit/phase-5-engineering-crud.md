# Phase 5 — Engineering Workspace CRUD & context menu

Branch `feat/engineering-workspace-crud`, from `master` at `9aeb33b` (Phases 1–4 merged: #75, #76, #77, #78). Working tree clean at the start. No migration planned.

## 0. What already exists (inspected, not rebuilt)

Read: `components/{SheetMarkup,MarkTables,MarkForm,EquipmentTable,WeldListEntry,EditPanel,ui/FormDialog}.jsx`, `components/workspace/*`, `app/piping/page.jsx`, `lib/sheet/{markup,mark-identity,weld-list-marks,weld-list-identity}.mjs`, `lib/register/mark-protection.mjs`, `app/api/runs/**`, `lib/db/repos/{review,register-persistence,iso-equipment,bom-allocation}.mjs`, the Phase 3 and Phase 4 audits.

| capability in the brief | state on master | where |
|---|---|---|
| Right-click on a mark → View, Edit, Duplicate, Move, Delete | **implemented** | `SheetMarkup.jsx` (`menuItems`, `view/edit/duplicate/remove`, `setPointFor` for Move), keyboard-navigable, closes on Esc/scroll/resize; every action takes the mark's `markRef` (uid, legacy id only as fallback) |
| Right-click on empty sheet → Add weld / spool / support / equipment | **implemented** | same menu; opens `MarkForm` in create mode with the click point (`onAdd`) |
| Move preserves uid | **implemented** (Phase 3/4: `placeAt`; typed rows move `byUid`) | tested in `workspace-foundation.mjs`, `typed-weld-identity.mjs` |
| One form for view / edit / create, per class | **implemented** | `MarkForm.jsx` on `FormDialog` (required `*`, dirty pill, Esc/backdrop/cancel asks before discarding, local validation, duplicate-number check by identity, unknown attributes preserved by spreading `mark.attrs`) |
| Table ↔ drawing selection by uid | **implemented** (Phase 3) | `markRef`/`isMark` in `SheetMarkup`, `MarkTables`, `EquipmentTable`, `Explorer`; panels stay mounted so selection survives tab switches |
| Delete: confirmation + dependency warnings | **implemented** | `dependents()` (spool members, tie-in references, equipment joins, accessories) in the confirm text |
| Delete: saved-state protection preview | **only in the typed workspace** (`WeldListEntry`, Phase 3) | the model route (`app/piping/page.jsx`) renders the same `SheetMarkup` / `MarkTables` with **no** `protect` |
| Server authority | **implemented** | installed/tested equipment, installed allocation lines, approved BOM, `RUN_NOT_CURRENT`, `RUN_LOCKED`, `MARK_IDENTITY_AMBIGUOUS`, `MARK_UID_CONFLICT` |

Typed weld rows: they are **register rows**, not `sheetMarkup.items` (Phase 4). Through `itemsFromWeldRows` / `weldRowsFromItems` the same menu, form and tables operate on them as rows: view/edit/move/duplicate/delete act on the row (uid-first); they have no equipment link, no BOM allocation and no saved protection state, so the protection preview never blocks them. That separation is kept as it is.

## 1. Gaps found

| # | gap | evidence | action |
|---|---|---|---|
| G1 | **Duplicate copies operational state.** `duplicateMark` copies `attrs` whole; an equipment mark's `attrs.status` (`installed` / `tested`) is what the server reads as the equipment's installation status, so a copy of an installed item is born installed (and cannot then be removed without a return) | `lib/sheet/markup.mjs duplicateMark`; `iso-equipment.mjs syncEquipment` reads `a.status` | copies engineering attributes, **resets installation state** to planned; allocation lines are keyed by uid so none are copied |
| G2 | Delete preview missing on the model route | `app/piping/page.jsx` has no `protect` | shared hook used by both workspaces |
| G3 | The preview says *that* a delete is refused but not *which authorised workflow* clears it | `mark-protection.mjs` messages | messages name the workflow (return the installation in the allocation ledger / reset the equipment status, new revision for an approved run) |
| G4 | Drawing selection highlights the table row (`.sel`) but does not scroll it into view, and does not move to the table of the mark's class | `MarkTables` scrolls only for the explicit `focus` (edit) | follow the selection: scroll the row into view; in the register tabs, show the tab of the selected mark's class |
| G5 | The form does not show the mark's identity | `MarkForm` | uid (and legacy handle) as read-only technical metadata |
| G6 | **No stale-edit detection.** `POST /api/runs/[id]/edits` overwrites whatever is stored; two engineers correcting the same run silently overwrite each other | `applyCorrection` | additive `baseHash`: the run's `payloadHash` is returned by `GET /api/runs/[id]` and by the edit; an edit whose `baseHash` is no longer the stored one is refused (409 `STALE_RUN`) and the page reloads the run |
| G7 | The menu is built inline in the component, so "right-click on a mark offers X, targeting this uid" cannot be tested without a browser | `SheetMarkup.jsx` | pure `lib/sheet/mark-menu.mjs` builder (the component maps actions onto it) |

Not gaps (left alone): the form's fields (all have persistence support; none invented), the keyboard behaviour of the menu, the drawing geometry and coordinates, the BOM table (Phase 3).

## 2. Plan
1. This document. 2. G1 + G7 in `lib/sheet`. 3. G2 + G3 (`lib/client/saved-protection.mjs`, wording in `mark-protection.mjs`, both workspaces). 4. G4 + G5. 5. G6 (server + `EditPanel`). 6. Tests, browser drives with screenshots (light/dark, desktop/narrow), results.

## 3. What was changed

| gap | change | files |
|---|---|---|
| G1 | `duplicateMark` copies the engineering description and **drops installation state** (`OPERATIONAL_ATTRS = {status}`); a copy starts planned. Allocation lines and accessory statuses are keyed by uid on the server, so none are copied | `lib/sheet/markup.mjs` |
| G7 | the menu is a pure builder; `SheetMarkup` only maps actions onto it. Every item carries `target` = the mark's `markRef` | `lib/sheet/mark-menu.mjs` (new), `components/SheetMarkup.jsx` |
| G2 | one hook reads the saved equipment/allocation state for a saved revision (`GET /api/iso-equipment`, `GET /api/bom-allocations`) and hands `protect(ref)` to the sheet and its tables; used by **both** workspaces | `lib/client/saved-protection.mjs` (new), `components/WeldListEntry.jsx`, `app/piping/page.jsx`, `components/{SheetMarkup,MarkTables,EquipmentTable}.jsx` |
| G3 | messages name the authorised workflow (return the equipment's status to planned, return the installation in the BOM allocation ledger, register a new revision for an approved run) | `lib/register/mark-protection.mjs` |
| — | the delete confirmation is an in-page dialog instead of native `alert`/`confirm` (it can be styled, tested and looked at): *blocked* (reasons + way out, only «بستن») or *confirm* (what still refers to it; «حذف» / «انصراف»). It is always asked; the server still decides | `components/ui/ConfirmDialog.jsx` (new) + the three delete sites |
| G4 | a mark picked on the drawing or in the explorer is shown in the tables: its row is scrolled into view, the register tab of its class is shown (only while the panel is on a register tab) | `components/{MarkTables,EquipmentTable,WeldListEntry}.jsx` |
| G5 | the form shows the uid (or the legacy id, marked as such) as read-only technical metadata | `components/MarkForm.jsx` |
| G6 | **stale-edit detection**: `GET /api/runs/[id]` returns `run.payloadHash`; a correction may send `baseHash`; the run row is locked (`FOR UPDATE`) and re-read inside the transaction, and a mismatch is refused — 409 `STALE_RUN`, nothing written or logged; the response carries the new hash; `EditPanel` sends it and offers «باز کردن نسخهٔ تازه». A correction that names no base behaves as before | `lib/review/payload-hash.mjs` (new), `lib/db/repos/review.mjs`, `app/api/runs/[id]/{route,edits/route}.js`, `components/EditPanel.jsx`, `app/piping/page.jsx` |

No migration, no new table, no change to the extraction engine, geometry/coordinates, authorization, revision locks, the BOM three-state rule or the Phase 2–4 identity contracts. No second identity system: everything resolves through `markRef` / `isMark` / `findMark`.

### 3.1 Operations by object type
| operation | weld (sheet mark) | spool | support | equipment | typed weld **row** |
|---|---|---|---|---|---|
| right-click menu on the mark | ✓ | ✓ | ✓ | ✓ | ✓ (acts on the row, by the row's uid) |
| view / edit (same form, all fields that have persistence support) | ✓ | ✓ | ✓ | ✓ (+ welds, accessories, status) | ✓ |
| move (uid kept, only coordinates change) | ✓ | ✓ | ✓ | ✓ | ✓ (`weldMarkup.byUid`) |
| duplicate (new uid, attributes copied, installation state not) | ✓ | ✓ | ✓ | ✓ (starts planned) | ✓ (new row, new uid) |
| delete (dialog, dependants listed) | ✓ | ✓ | ✓ | ✓ | ✓ |
| delete protection from saved state | no saved state of its own | no | no | **installed / tested / accessories held** | none — typed welds have no equipment link or allocation (Phase 4) |
| right-click on the empty sheet → add weld (shop/field), spool, support, equipment | ✓ (`weld-unknown` is not offered) | | | | creates a row |

### 3.2 Deferred on purpose
* **Stale detection for `POST /api/runs`** (saving a new run of the same drawing): that route appends a run rather than overwriting one, so it has no lost update in the sense G6 closes; making two people's parallel *new runs* visible to each other is a product decision (which one is current) and was not invented here.
* The delete dialog does not replace the `window.confirm` calls of unrelated tables (BOM, cut list); only mark deletion was in scope.
* Concurrency on the form itself (two people editing the same mark in two open forms before either saves) is covered only through the run-level check at save.
* Typed welds are still not in `sheetMarkup.items` (Phase 4 decision): no BOM reservation or equipment link follows them, so there is no protection to preview for them.

## 4. Tests

Guards proved by reverting: duplicate keeping `status` → 1 red; stale check removed → 2 red; menu item renamed → 1 red.

| run | result |
|---|---|
| `db/test/engineering-crud.mjs` (PGlite) | 16/16 |
| same, `typed-weld-identity`, `register-persistence`, `mark-identity`, `workspace-foundation` on real PostgreSQL 16 | 16/16, 17/17, 13/13, 20/20, 23/23 |
| `npm run db:test` (PGlite, whole chain) | exit 0 · 119 files · 1494 PASS · 0 FAIL |
| `npm run eval:check` | GATE PASSED |
| `npx next build` | succeeded |
| `tools/drive-engineering-crud.mjs` (real page, saved run with a weld list, spool, support and **installed** equipment) | 26/26 checks, 0 page errors |

The drive covers: right-click on a weld, spool, support and equipment (5 items each) and on the empty sheet (the four creatable types); the edit form (uid read-only, dirty pill, cancel asks first, refusing keeps it open, nothing changed); **protected delete** (the in-page dialog says «نصب‌شده» and the authorised way; equipment stays); duplicate → a new uid-shaped reference, +1 mark; delete: cancel keeps it, confirm removes only that mark; move keeps the uid and changes the place; drawing click → panel moves to the Welds table and that row is selected; row click → that one mark is picked on the drawing; light and dark; 390 px wide, no horizontal scroll.

Requirement → test: 1 menu · 2 view/edit target the uid (two marks with the same number) · 3 move · 4–5 duplicate and no ownership · 6 confirmation (drive) · 7 protected delete (pure + server `7b`) · 8–10 selection both ways and save shows in both · 11 stale/conflict · 12 approved revision (`12`, `12b`) · 13 legacy mark · 14 typed rows · 15 Phase 1–4 suites green in the full chain.

**Not executed:** the full `db:test:pg` chain (only the five files above on PostgreSQL); the browser drive was run on PGlite with the sample sheet's PDF only; DOM-level component tests do not exist in this repository (behaviour is verified by the drive and by the pure/route tests); older drives under `tools/` that relied on `window.confirm` for mark deletion were not re-run.

Screenshots: `docs/audit/phase-5-shots/` — menus on weld / spool (dark and light) / support / equipment, empty-area menu, edit form, delete-protection dialog, delete-confirm dialog, synchronized selection (dark and light), narrow viewport.

## 5. Remaining risks
* The delete preview reads saved state when the page opens the run; if another person changes it afterwards the preview can be out of date — the server refuses regardless, which is the point of keeping it advisory.
* `baseHash` is optional (callers that omit it keep today's last-writer-wins); only `EditPanel` sends it.
* `payloadHash` is a hash of the stored jsonb as serialised by the driver; it is compared only with itself, never with a client-computed value.
* Existing external scripts that drove the native delete `confirm` must now click the dialog.

## 6. Deployment impact
None beyond a normal deploy: no migration, no data change. `GET /api/runs/[id]` gains `run.payloadHash` and the corrections response gains `payloadHash` (additive).
