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
