# Phase 6 — Weld identity, BOM allocation and equipment traceability

Branch `feat/weld-bom-equipment-integration`, from `master` at `fb19717` (Phases 1–5 merged). Working tree clean at the start.

## 0. What was read and traced
`lib/sheet/{weld-list-marks,weld-list-identity,mark-identity,markup}.mjs`, `lib/register/{bom-allocation,weld-list}.mjs`, `lib/db/repos/{bom-allocation,iso-equipment,register-persistence,review,mark-identity}.mjs`, `components/{WeldListEntry,MarkForm,MarkTables,EquipmentTable,BomTable}.jsx`, `app/api/{runs,bom-allocations,iso-equipment}/**`, migrations 097–105, the Phase 1–5 tests and audits.

## 1. Lifecycle as it is on `master`

| step | what happens | identity used |
|---|---|---|
| A–B typed row created / uid | `withRowIds` → `weldList[i].uid` (Phase 4) | uid |
| C placement | `weldMarkup.byUid[uid]` (+ legacy `marks[no]`) | uid |
| D save | `payload = { weldList, weldMarkup, sheetMarkup: { items: spool/support/equipment }, bom, … }`; `prepareSheetPayload` settles the rows' uids; `persistRegister` registers them | uid |
| E register | `weld` rows: `weld_uid` minted/carried by `matchRegisters` (number + attributes) — the register-level identity | **number** (typed) |
| F allocation | `syncSheetData` builds demands from **`payload.sheetMarkup.items`** (`ledgerDemands(items, bom)`) | `ownerKey(mark)` = uid |
| G equipment → weld | `syncEquipment` resolves the equipment's `attrs.welds` (**printed numbers**) with `byNo` over the weld marks **of `sheetMarkup.items`** | number |
| H reopen | rows/marks come back; equipment marks (Phase 5) too | uid |
| I edit / renumber / move | uid kept (Phase 4); `attrs.welds` of an equipment still holds the **old number** | — |
| J duplicate / delete | new uid / uid retired; a deleted weld silently drops its `iso_equipment_weld` row | — |
| K revision | new document → new marks; uid registered to one document (`MARK_UID_CONFLICT`) | uid |
| L correction | `applyCorrection` re-derives the register; `syncSheetData` only when `touchesSheetData` (paths `bom`, `sheetMarkup`) | — |

## 2. The explicit findings

**Sources of weld identity today** — (1) `weldList[].uid` (typed rows, registered in `sheet_mark_identity`, cls `weld`); (2) `sheetMarkup.items[].uid` (sheet weld marks); (3) `weld.weld_uid` (the register's, carried across revisions by `matchRegisters` — a different, register-level identity, left alone); (4) `iso_equipment_weld.weld_ref` and `bom_allocation.owner_ref` — both text columns holding `ownerKey(mark)` (uid, legacy id only for a mark that had none; migration 105 rewrote old ones to `legacy_mark_uid`).

**Where the printed number still decides something**
* `syncEquipment`: `byNo = new Map(weldMarks.map(w => [plainNo(w.no), w]))` — on a repeated number the **last** weld wins: an incorrect link, silently.
* `equipment.attrs.welds` (a comma list of numbers) is the only way an equipment names its welds; renumbering a weld leaves it pointing at a number that is no longer there or is now another weld's.
* `dependents()`, `equipmentChecks()` and the form's weld checkboxes (`MarkForm`, keyed by number).
* The tick list `reviewed`, `progress[no]` and `matchRegisters` for typed lists: display / register-carry-over, not ownership; unchanged.

**How typed weld rows reach allocation — they do not.** `syncSheetData` reads `payload.sheetMarkup.items`, which for a typed list holds only spool/support/equipment. `ledgerDemands` therefore never sees a typed weld: no reservation is ever written for one, although the typed workspace shows a live «used / capacity» computed from the rows — **the page shows reservations the server never makes**. For the same reason `iso_equipment_weld` is never populated for typed lists (no weld marks to resolve the numbers against).

**Can duplicate numbers cause wrong associations?** Typed lists cannot save a repeated number (the register check refuses). Sheet-mark payloads can (`problems()` warns but does not block): there `byNo` picks one arbitrarily — yes, an equipment can be linked to the wrong weld.

**Protection of installed / reserved lines (unchanged, relied on).** `syncAllocations` refuses to release or reduce an installed line (409); reserved lines are adjusted/released with an event row; `transition` locks the line; the BOM-row ceiling is a trigger under a row lock; `verifyLedger` re-checks after a BOM write; `bom_allocation_event` is append-only (REVOKE + snapshot columns, 104). `syncEquipment` refuses to remove installed/tested equipment.

**Old payloads / legacy references.** Typed runs have no allocation or equipment-weld rows at all. Sheet-mark runs had `weld_ref`/`owner_ref` converted to uids by 105. Equipment marks carry numbers in `attrs.welds`.

**Is a migration necessary? No.** `iso_equipment_weld.weld_ref` and `bom_allocation.owner_ref` are free text already holding uids; `sheet_mark_identity.cls` allows `weld`; the warning table's `kind` allows `'ambiguous'` (the detail is jsonb, so a typed detail fits). No constraint, index or foreign key has to change. See §5.

## 3. Strategy

### 3.1 One canonical projection, owned by nothing new
`lib/sheet/weld-projection.mjs` (pure) answers "what welds does this payload have?" — a **view computed from the payload on every save**, never stored and never edited:
* `payload.weldList` is an array → the **typed rows are the welds** (this is already what `modelFor` treats as the register). Each row is exposed as a weld mark `{ uid, kind (shop/field/unknown from loc), no, attrs: { c1, c1s, c2, c2s, size, type, spool, … } }`.
* otherwise → the sheet's weld marks are the welds (geometry route, unchanged).
* **Both representations present** (typed rows and sheet weld marks): a sheet weld mark with the **same uid** as a row *is that weld* and adds nothing; a sheet weld mark that matches no row by uid **holds nothing and is reported** — it is never matched by number or position, and never reserves a second time.
`effectiveItems(payload)` = the sheet's non-weld marks + the projected welds. Allocation and equipment synchronisation read it instead of the bare `sheetMarkup.items`. Storage is unchanged: rows stay in `weldList`, marks in `sheetMarkup.items` — no second source of truth.

### 3.2 Allocation
`ledgerDemands(effectiveItems, bom)` already keys a weld demand by `ownerKey` = uid with `ownerNo` = the printed number. A typed weld with `c1`/`c2` therefore reserves its PT (capacity rules, trigger, ledger and history are the existing ones); a weld with no component reserves nothing; a PT not in the revision's BOM holds nothing and is reported (the existing `inBom` rule, now surfaced to the user as a finding). Saving typed rows therefore **can** now be refused with the existing 409 `BOM_ALLOCATION` when a PT has fewer ends left than welds ask — that is the capacity rule applied, not a new rule.

### 3.3 Equipment → weld by uid
* New hidden equipment attribute **`weldRefs`**: the uids of the welds it joins (canonical). `attrs.welds` stays as the human list of numbers (display, legacy), written alongside by the form.
* `syncEquipment` resolves **`weldRefs` first**. A uid that is not a weld of the sheet → 409 `EQUIPMENT_WELD_MISSING` (names the equipment and the weld; the way out: remove the link in the equipment form) — this is what makes deleting a referenced weld a blocked operation instead of a silently dropped link.
* **No `weldRefs` (legacy)**: each number is resolved only if exactly one weld has that number; an ambiguous or missing number links nothing, is recorded as a warning (`sheet_mark_warning`, `kind = 'ambiguous'`, `detail.type = 'equipment_weld'`) and **existing links are left as they are** (a proven link is never dropped because a number became ambiguous).
* The form (equipment) selects welds by uid; the page also resolves the legacy numbers with the same rule when it opens an equipment, shows unresolved ones explicitly and writes `weldRefs` on save.

### 3.4 Corrections
`touchesSheetData` also fires for edits of `weldList[i].c1|c2|no|uid` (a row added/removed shows as such edits), so a correction that changes what a typed weld holds re-makes allocations and links in the same transaction; the existing `RUN_NOT_CURRENT` rule (dependents belong to the revision's current run) applies to those edits too.

### 3.5 UI (no redesign)
* Weld form: uid read-only (Phase 5), component pickers (`BomPick`, existing: shows description, size and what is left), plus read-only «تخصیص ذخیره‌شده» (the weld's saved lines) and «تجهیزات متصل».
* Equipment form: welds by uid (number + short uid), unresolved legacy numbers listed, no duplicates.
* BOM tab: per PT — total, reserved, installed, remaining (server ledger), the **consumers** (welds / equipment / accessories with their lines) and the revision's **history**, read from `GET /api/bom-allocations` (`?history=1`); the live «used / capacity» column stays and is labelled as a preview.
* Delete preview: a weld that an equipment still names is **blocked** (with the way out), draft or saved.

## 4. Plan
1. This document. 2. `weld-projection.mjs`. 3. `syncSheetData` / `syncEquipment` / `touchesSheetData`. 4. Equipment form, weld form, BOM tab, delete preview. 5. Tests (identity, BOM, equipment, concurrency). 6. Browser verification, results.

## 5. Migration decision
None created. Reasons are in §2. If a deployment holds rows that contradict this (an `iso_equipment_weld.weld_ref` that is neither a uid nor a legacy id) they are not rewritten: the ambiguity is reported, never resolved by guessing.
