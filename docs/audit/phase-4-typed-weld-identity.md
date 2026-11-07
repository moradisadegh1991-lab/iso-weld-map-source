# Phase 4 — Persistent identity for typed weld lists

Branch `feat/typed-weld-identity`, from `master` at `9eae1f8` (Phases 1–3 merged: #75 persistence, #76 stable mark identity, #77 workspace foundation). Working tree clean at the start. No migration planned.

## 0. State inspected
* Merge state: migrations 104 and 105 are on `master`; `sheet_mark_identity` / `sheet_mark_warning` exist; `reconcileSheetMarks`, `registerMarks`, `recordMarkWarnings`, `prepareSheetPayload` are in use by `POST /api/runs` and `applyCorrection`.
* Read: `lib/sheet/weld-list-marks.mjs`, `lib/sheet/markup.mjs`, `lib/sheet/mark-identity.mjs`, `lib/register/weld-list.mjs`, `components/WeldListEntry.jsx`, `app/api/runs/route.js`, `lib/db/repos/{register-persistence,review,runs,mark-identity,iso-equipment}.mjs`, `lib/register/match.mjs`, `lib/review/payload-diff.mjs`, migration 105, `db/test/{weld-marks,sheet-markup,mark-identity,register-persistence}.mjs`.

## 1. Lifecycle trace — where identity is lost

| step | what happens today | identity used |
|---|---|---|
| create a typed row | `withRowIds` gives it `_id = "r" + Date.now().toString(36) + seq` | a **temporary UI id** |
| its drawing mark | `itemsFromWeldRows` builds `{ id: r._id, kind, no, x, y, attrs }`; **no `uid`**. Placement is `weldMarkup.marks[no]` | `_id`, and the **printed number** for the position |
| save | payload = `weldList` (rows via `registerRow`, which strips `_id`), `weldMarkup.marks` (keyed by number), `sheetMarkup.items` = **only the spool/support/equipment extras**. Weld marks are not in `sheetMarkup.items` | none persisted for a weld |
| server | `prepareSheetPayload` / `registerMarks` / `syncEquipment` / `syncAllocations` only see `sheetMarkup.items` → typed welds are never reconciled, never registered in `sheet_mark_identity`, never an owner of an allocation, never a link of an equipment (`iso_equipment_weld` is built from weld marks of `items`) | the DB's `weld.weld_uid` is minted by `matchRegisters` (number + attributes) — a different, register-level identity |
| close / reopen | rows come back without any id → `withRowIds` mints a **new** `_id`; marks are re-attached **by number** | printed number |
| edit attributes | same `_id`, same number → fine in session; nothing persistent | `_id` |
| renumber | `setCell("no")` moves the `marks[old]` key to `marks[new]` **only if `marks[new]` is free**; a swap or a rename onto an existing key silently keeps the wrong place | printed number |
| move | `placeAt` changes the mark; `weldRowsFromItems` writes `marks[no]` back. Two rows with the same number (possible while typing — the register check refuses to *save* it) share one key: the second overwrites the first | printed number |
| duplicate | `duplicateMark` strips `uid`/`id`; the copy takes the next free number. Fine, but the copy has no persistent identity either | none |
| delete | the row goes; its `marks[no]` entry is dropped; nothing says the identity is retired | none |
| new revision | a new document: the register's `weld.weld_uid` is carried by `matchRegisters`; marks are new | by number (register) |
| correct a saved run | `applyCorrection` → `prepareSheetPayload(previousItems = sheetMarkup.items)` → weld rows are not in the list reconciled; `weld.weld_uid` carried by `matchRegisters` | number + attributes |

Two further findings in the same flow:
* **`reviewed`** (the "checked against the drawing" ticks) is a list of weld **numbers**.
* **Equipment marks are dropped on reopen.** `WeldListEntry` initialises `extras` with `filter(m => spool || support)`, so a saved equipment mark (and its accessories, BOM piece demands, uid) is not loaded; the next save then removes planned equipment or is refused with 409 for installed/tested equipment. That is an identity loss in the same flow.

### Root cause
The typed Weld List has **no persistent identity at all** for its welds: the row id is a throw-away UI key, the persisted placement is keyed by the printed number, and the weld rows never enter the Phase 2 identity registry because they are not part of `sheetMarkup.items`. Phase 2's contract (uid per mark, reconciliation, registry) therefore does not cover them.

## 2. Contract

### Identity
* **`weldList[i].uid`** — a UUID, the weld row's persistent identity and the identity of its mark. Same format and same registry as every other mark (`isUid`, `sheet_mark_identity`, `cls = 'weld'`): **one identity system**, no second one.
* `_id` stays a UI key only. It is never persisted (`registerRow` strips it, as before) and never used as a reference.
* The printed number `no` is a display/business attribute.
* A uid belongs to ONE drawing revision (existing Phase 2 rule): a uid registered to another revision is refused (409 `MARK_UID_CONFLICT`); a new revision's rows are new rows. No cross-revision lineage is invented.

### Placement
* **`weldMarkup.byUid[uid] = { x, y, [ax, ay], src }`** — identity-keyed placement, written by the new client.
* **`weldMarkup.marks[no]`** — the legacy, number-keyed placement, still **written** (only for numbers that are unique in the list, so old readers keep working) and still **read** as a fallback: a row with no `byUid` entry takes `marks[no]` only if its number is unique among the typed rows. A duplicated number is never resolved from `marks` (it is not guessed).
* Legacy location data is never discarded: at load, a unique-number legacy placement is *adopted* into `byUid`; the legacy map is kept.

### Compatibility
| input | behaviour |
|---|---|
| payload without any `uid` (all saved runs today) | readable; rows get a uid when loaded in the page; on save the server reconciles (below) and stores the uids |
| `weldMarkup.marks` only | read through the fallback above |
| a client that never sends `uid` / `byUid` (API caller, older page) | accepted; the server issues uids by reconciliation |
| `reviewed` (numbers) | unchanged (a QA tick, not an identity); documented as remaining |

### Server reconciliation (reuses `reconcileMarks` / `reconcileSheetMarks`)
`prepareSheetPayload` also handles `payload.weldList` (a `previousRows` argument is added; `previousItems` keeps its meaning). Each row is viewed as a weld mark `{ uid, kind (from loc), no, attrs: { size: nps, type: kind, spool } }`:
1. a row whose uid is one of the previous run's rows keeps it;
2. a row with a uid nobody knows is a new row that already carries its identity (copy, typed row) and keeps it;
3. a row with **no** uid is matched to a previous row of the same class and number only if unique and attribute-compatible (`reconcileMarks` rules); otherwise it gets a **new** uid;
4. an ambiguity is recorded in `sheet_mark_warning` (existing warning mechanism) and, if something installed/tested stands on a candidate, refused with 409 `MARK_IDENTITY_AMBIGUOUS` (existing rule);
5. previous rows nothing claims are reported as `removed`; **their uids are never reused**;
6. `byUid` keys follow a uid that the server had to replace (a second copy carrying a used uid) only when the old key is not another row's.
Every resulting uid is registered (`registerMarks`) inside the save/correction transaction (`persistRegister`), so a uid of another revision rolls the whole save back.

### Not changed on purpose
* Typed welds are **not** added to `sheetMarkup.items`. Doing so would start reserving BOM ends for typed welds and linking equipment to them — an operational behaviour change that belongs to a separate decision. Consequence: today no allocation or equipment link refers to a typed weld, so none can be transferred; the registry now guarantees the identity if/when they do.
* The register's `weld.weld_uid` (NDT/ITR carry-over by `matchRegisters`) is a different, register-level identity and stays as it is.
* No migration: `sheet_mark_identity.cls` already allows `'weld'`.

## 3. Plan
1. `weld-list-marks.mjs`: uid on rows and marks, `byUid` placement with safe legacy fallback, duplicate-safe.
2. `WeldListEntry`: `byUid` state, payload, selection by uid, equipment kept on reopen.
3. Server: `weld-list-identity.mjs` (pure), `prepareSheetPayload` + `persistRegister` + the two callers; edit-history ignores identity adoption.
4. Tests, results, risks (sections 4+ below, filled in at the end).
