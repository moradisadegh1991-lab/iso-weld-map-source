# Phase 7 — Engineering Validation & Reconciliation Center

Branch `feat/engineering-validation-center`, from `master` at `e405a16` (Phases 1–6 merged). Working tree clean at the start.

## 0. Evidence about the Phase 6 «pending Vercel checks»
Read from GitHub with `gh api` (not assumed):
* PR #80 head `420e150`: combined status **success**, four Vercel statuses (`iso-weld-map-source`, `-acai`, `-gemini-relay`, `-petd`), each «Deployment has completed».
* Master merge commit `e405a16`: the same four Vercel statuses are **success** (09:33–09:36 UTC); check runs `build`, `eval`, `pg-scope` completed **success**; `data-layer` of the master push run was **still in progress** when this was written (re-checked at the end of the phase, see the results section).
So nothing is «pending» on Vercel; the only open item at that moment was `data-layer` of the push run.

## 1. Existing validation, as found

| where | what | server? | structured? |
|---|---|---|---|
| `lib/register/weld-list.mjs` `modelFromWeldList` | per row: number missing/duplicate, location not Shop/Field, joint type, NPS, shop weld without spool → `problems` (Persian strings); the **save refuses** a list with problems (400) | yes (`POST /api/runs`) | no (strings «ردیف N: …») |
| `lib/sheet/markup.mjs` `problems`, `rules`, `componentChecks`, `equipmentChecks` | duplicate/missing numbers, spool/support rules, weld components vs BOM, equipment vs BOM/welds/spool/accessories | no (client) | no (strings; some are uid-less) |
| `lib/register/bom-allocation.mjs` `usage`, `canTake`, `allocationChecks`, `pieceDemands`, `ledgerDemands` | live use of each BOM row's welded ends and pieces; over-allocation text | the **rules** are shared; the **ceiling** is the DB trigger | no |
| `lib/register/bom-table.mjs` `rowIssues`, `decorate`, `deleteCheck` | BOM row checks, saved-ledger overlay | client | partly |
| `lib/register/cut-model.mjs`, `cut-bom.mjs` | cut table vs sheet, vs BOM | no | no |
| `lib/register/workspace-validation.mjs` (Phase 3) + `ValidationPanel.jsx` | one **list of strings** from all of the above, grouped by source; a link only when the text starts «سرجوش N:» | no | `{ source, level, message, ref }` |
| `lib/register/mark-protection.mjs` | delete preview (saved equipment/allocations/approved) | advice only | reasons |
| server-side refusals | `BOM_LOCKED`, `BOM_IN_USE`, `BOM_ALLOCATION` (capacity trigger, installed lines), `EQUIPMENT` (installed/tested), `EQUIPMENT_WELD_MISSING`, `MARK_IDENTITY_AMBIGUOUS`, `MARK_UID_CONFLICT`, `RUN_LOCKED`, `RUN_NOT_CURRENT`, `STALE_RUN` | yes | error codes |

**Warning storage and resolution.** `sheet_mark_warning` (migration 105; `kind IN ('ambiguous','removed')`, `detail jsonb`, `resolved_at/by`, `resolution`) is written by `recordMarkWarnings` (identity ambiguity) and, since Phase 6, `recordEquipmentWeldWarnings` (legacy equipment → weld). `markWarnings` reads them and `resolveMarkWarning` closes one with a required note. **There is no route and no screen for either**: warnings are written and never seen.

**Revision and approval protections (relied on, not changed).** An approved run is locked (`RUN_LOCKED`, DB trigger); BOM of an approved revision is `BOM_LOCKED`; dependents belong to the revision's **current** run (`RUN_NOT_CURRENT`); a uid belongs to one drawing revision (`MARK_UID_CONFLICT`); corrections can name the state they were made against (`STALE_RUN`).

## 2. Gaps (what is genuinely missing)
1. The checks are strings without an entity identity, a code, a category, a revision or a source; a finding cannot be navigated to its mark or row by uid, nor filtered, nor counted by category.
2. **No view of the saved ledger/equipment against the draft** (preview vs saved vs installed vs available are never shown side by side).
3. Rules that exist nowhere: duplicate persistent uid; typed weld without uid; a weld naming a PT that is not in the BOM (only a *snapshot* difference is reported); BOM row deleted/shrunk while the saved ledger holds it (only found by the server's refusal at save); installed line whose owner disappeared; dangling equipment→weld uid; ambiguous legacy number; unlinked sheet weld marks (Phase 6 deferred); duplicate representation; saved ledger over capacity; installed/tested equipment whose mark is gone; BOM unit validity; weldable row without size.
4. No screen for `sheet_mark_warning`.
5. The Validation tab exists only in the typed workspace (`WeldListEntry`); the model route has none (left as it is, stated).

## 3. Architecture

### 3.1 One engine, one structure — `lib/engineering/validation.mjs` (pure)
`validate(ctx)` returns findings in one shape: `{ id, code, category, severity, entityType, entityUid, entityNumber, title, message, suggestedAction, source, revision, resolved, blocking, … }` with categories `identity · geometry · weld · bom · allocation · equipment · spool · support · revision · data-integrity`. `id` is deterministic (`code:entityUid:detail`) so a refresh keeps selection and a resolved/unresolved comparison is possible. `entityUid` is always the persistent uid when one exists; the printed number is `entityNumber` (display).
It is **not** another data source. Its input is exactly what already exists:
* the payload (`weldList`, `sheetMarkup.items`, `bom`, `cutLengths`) through `projectWelds` (Phase 6) — typed rows and sheet marks each once;
* the saved state: `listEquipment`, `availability` (+ lines), `markWarnings` — the same repository functions the existing routes use;
* the revision (`document`, run status).
It **reuses** the existing rules instead of re-writing them: `modelFromWeldList` (made to also return structured row problems, strings unchanged), `rowIssues`/`rowCapacity` (BOM), `usage`/`ledgerDemands`/`pieceDemands` (capacity and demand), `equipmentWelds` (links), `cutChecks`/`cutVsBom` (cut table). The old string functions stay for the inline table notes; the Center stops using them as its source.
The engine runs **in the page** (draft, live preview — labelled as such) and **on the server** (saved state — authoritative): same code, different input, a `source` on every finding says which.

### 3.2 Server API (read-only, one new route + the warning pair)
* `GET /api/validation?projectId&documentId` — authenticated (`VIEW_PROJECT`), project/revision-scoped; loads the revision's latest valid run, saved equipment, ledger (rows + lines) and warnings in a **fixed number of queries** (no per-entity queries) and returns `{ revision, findings, summary, payloadHash, generatedAt }`. Nothing is cached or stored: a result table has no demonstrated need (the result is cheap and always derivable).
* `GET /api/mark-warnings?projectId&documentId` (read, history included) and `POST /api/mark-warnings` `{ projectId, warningId, resolution }` — `EDIT_EXTRACTION`; refuses on an approved revision; **the server verifies that the relationship has actually been established** before it closes a warning (below); the warning's `detail` and creation are never touched — only `resolved_at/by/resolution` are set (existing `resolveMarkWarning`), so the evidence stays.

### 3.3 Resolution = an action the user performs with the existing forms
The Center offers *navigation to the place where the user fixes it* (the weld form, the equipment form, the BOM row form, the mark on the drawing). Nothing is repaired automatically. After a save, the Center re-validates; a finding that no longer holds disappears (it is a computed finding), and a warning is closed only through the explicit «حل شد» action, which the server accepts only if:
* `equipment_weld` warning: the equipment now has a stored weld link, to one of the warning's candidates when it had candidates (the choice was made);
* identity `ambiguous` warning: nothing hangs on the previous identities any more (no equipment, no installed/reserved allocation, no link) — then the note is recorded as the acknowledgement; if something does hang on them it stays open.

### 3.4 Unlinked sheet weld marks (Phase 6 deferred)
`projectWelds` already reports them. Today the typed workspace **drops** them silently at the next save (it keeps only spool/support/equipment). They are kept: the workspace carries them untouched in `sheetMarkup.items`, shows them on the drawing and in the weld table as marks that are not register rows (never converted into rows, never matched by number or position), and lists each as a finding with its uid, number, attributes and the reason.

### 3.5 Not changed
Extraction, geometry, uid contracts, migrations 104/105, constraints, revision protections, installed allocations and history. **No migration** is planned: warnings keep their table; findings are computed.

## 4. Plan
1. This document. 2. Structured row problems in `weld-list.mjs`. 3. The engine + catalog + tests. 4. Routes. 5. UI (Validation tab → Center, unlinked marks). 6. Tests, browser drive, results.
