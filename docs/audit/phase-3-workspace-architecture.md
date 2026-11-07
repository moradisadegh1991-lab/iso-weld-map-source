# Phase 3 — Piping Workspace: architecture audit and foundation

Branch `feat/piping-workspace-foundation`, from `master` at `8533bdb` (Phase 2 stable mark identity merged). Written **before** any code was changed.

## 0. State of the repository and of CI (checked, not assumed)

* `master` = `8533bdb` (#76 stable mark identity, migration 105) ← `9f30e4c` (#75 persistence unification, migration 104). `git diff master origin/feat/stable-mark-identity` is empty: nothing unique remains outside `master`. Older unmerged branches (`audit/*`, `claude/*`) are superseded history, not pending work.
* The PR runs of #75 and #76 were green (build, eval, pg-scope, data-layer, Vercel).
* **The push run on `master` for #75 (`9f30e4c`, run 42330785466) FAILED** in `data-layer`, 12 seconds into "Data layer tests": `db/test/llm-endpoints.mjs` — "a sealed secret opens only with its key… a changed byte: expected SECRET_UNREADABLE got undefined". Cause (read from the test): the case replaces the **second-to-last** character of the sealed box but chooses the replacement by looking at the **last** character, so when the character is already the chosen one the box is unchanged and opens fine — about one run in 64 (the nonce is random). It is unrelated to this work and to Phase 1/2; but `npm run db:test` is an `&&` chain, so in that run every file after `llm-endpoints.mjs` did not execute. A separate fix was suggested as its own task; nothing is changed here.
* The push run for `8533bdb` (#76) was `in_progress` when this audit was written; it is **not** assumed to have passed.

## 1. Architecture as it is

### 1.1 Entry points
* `/piping` (`app/piping/page.jsx`, 1051 lines) — extraction and review. Two branches:
  * **typed weld list** (`listed`): `components/WeldListEntry.jsx` — the two-region workspace (below).
  * **model route** (`!listed`, after an extraction): `WorkspaceFrame` with `TabNav` tabs (`weld, check, line, mto, cut, json, equip, truth, review`), `MarkTables`, `SheetMarkup`.
* `/piping/execution` (spool progress, override history), `/piping/joint`, `/piping/defaults` — other pages, not part of this phase.

### 1.2 The workspace that already exists (so it is not rebuilt)
* `components/workspace/WorkspaceFrame.jsx` — toolbar, explorer, drawing, **data panel** docked at the end or at the bottom, resizable (drag or arrow keys), collapsible, layout kept in `localStorage` (guarded); stacks below 900 px; logical (RTL-safe) sides.
* `components/workspace/WorkspaceTabs.jsx` — ARIA tabs (arrow keys, Home/End), **every panel stays mounted** so tab switches never discard state or selection.
* `components/workspace/Explorer.jsx` — drawing/sheet info, **layers (visibility per class)**, marks grouped by class.
* `components/SheetMarkup.jsx` — the drawing: zoom −/+/⤢, Ctrl+wheel zoom about the pointer, **pan by dragging**, keyboard stops per mark, locate-on-pick, layer visibility, **right-click menu** (mark: view / edit / duplicate / move / delete; empty sheet: add weld / spool / support / equipment), drag to move frame and weld point, PNG export. Positions are stored as **fractions of the sheet (0..1)**, never screen pixels.
* `components/MarkTables.jsx` (+ `MarkForm`, `EquipmentTable`) — display-only tables with one form for view / edit / add; `components/IsoInfo.jsx` — **View / Edit** in logical sections over the real metadata (`lib/register/iso-info.mjs`), required-field errors, warnings, "unapplied changes" pill, cancel restoring every value; `components/BomForm.jsx`, `CutList.jsx`, `BomWelds.jsx`.
* `WeldListEntry` tabs: `info, welds, spools, supports, equip, bom, cut, [style], import, save`.

### 1.3 Data flow
extraction (`/api/extract`, OCR, merge/sanitize) → payload `{ meta, nodes, edges, bom, cutLengths, lineData, sheetMarkup:{items}, weldList… }` → `POST /api/runs`: recompute the register with the engine, lock the drawing revision, settle mark identities (Phase 2), `createRun`, `persistRegister` → `syncSheetData`: BOM (3 states), equipment, allocations, all in one transaction (Phase 1). Corrections: `POST /api/runs/[id]/edits` → `applyCorrection`, same rules; sheet data only for the revision's current run.

### 1.4 API surface the workspace uses (contracts)
| route | verbs | used for |
|---|---|---|
| `/api/runs` | POST, GET | save a run + register; latest run of a document. Response additive `markIdentity`, `bomRows`, `allocation`, `equipment` |
| `/api/runs/[id]` | GET | the run with payload, register, edits, `documentId`, status |
| `/api/runs/[id]/edits` | POST, GET | correct a run (`{payload, reason}`); 409 `RUN_NOT_CURRENT`, `BOM_IN_USE`, `BOM_LOCKED`, `MARK_IDENTITY_AMBIGUOUS`, `MARK_UID_CONFLICT`, `EQUIPMENT`, `BOM_ALLOCATION` |
| `/api/runs/[id]/approve` | POST | sign the register (locks it and its BOM) |
| `/api/iso-equipment` | GET, POST | equipment of a revision (`markId` = persistent uid, `legacyId`), accessory status |
| `/api/bom-allocations` | GET, POST | per BOM row ceilings / reserved / installed / left, active lines, history; install / return / release |
| `/api/documents` | GET, POST | revisions and their files |

Authorization is server-side in every route (`VIEW_PROJECT`, `RUN_EXTRACTION`, `EDIT_EXTRACTION`, area checks). The client never writes to a table.

### 1.5 Stable mark identity (Phase 2) in the UI
A mark is `{ id (legacy handle), uid (persistent), kind, no, x, y, ax, ay, attrs, src }`. `markup.mjs` (`withIds`, `addMark`, `normalize`, `duplicateMark`) keeps / issues / renews `uid`. **But the workspace's selection is still the legacy handle**: `markSel` (page and `WeldListEntry`) holds `m.id`; `SheetMarkup`, `MarkTables`, `Explorer`, `EquipmentTable` compare `m.id === selectedId` and `data-mark-id={m.id}`. The handle is re-issued by a re-extraction, so a selection (and anything keyed on it) can land on another mark.

## 2. Gaps against the Phase 3 brief (what is genuinely missing)

| brief | state | action in this phase |
|---|---|---|
| Two regions, tabs, light/dark | **exists** | none (verify) |
| Zoom, pan, layers, selection highlight, context menu | **exists** | add an explicit **Fit** and **Reset view** (zoom 1 = fit width today; no fit-to-box, no scroll reset) |
| Single selection source of truth by **uid** | one state, but keyed by the legacy handle | key it by `uid` (legacy fallback), one helper used by every component |
| Tab **Validation** | in `WeldListEntry` there is none (problems appear only as a badge on "Save") | a tab that lists the checks that already exist |
| **BOM table**: search, filter, sort, add / edit / delete, empty state, allocation info, row validation | inside a collapsed `<details>`, **only when rows exist** (so no way to add the first row), no search / filter / sort, only the live usage column | a BOM table component with all of them |
| Delete **protection** message | server refuses at save (409 with a message); nothing before | a pre-check from the data the page can already fetch, same wording; server stays the authority |
| Iso Info view / edit / dirty / validation | **exists** | none |
| Duplicate = new uid, no operational history copied | `duplicateMark` drops `uid`; allocations are keyed by uid so none are copied | tested, nothing to change |

Deliberately **not** touched: extraction engine, geometry, coordinates, the identity contract, authorization, migrations 104/105.

## 3. Plan (small, separately reviewable changes)
1. This document.
2. `lib/client/mark-selection.mjs` (pure) + use it in `SheetMarkup`, `MarkTables`, `Explorer`, `EquipmentTable`, the page and `WeldListEntry`.
3. Fit / Reset in `SheetMarkup`.
4. `lib/register/bom-table.mjs` + `components/BomTable.jsx` in the BOM tab.
5. `lib/register/workspace-validation.mjs` + a Validation tab.
6. `lib/register/mark-protection.mjs` + the delete pre-check.
7. Tests, results, screenshots, notes.
