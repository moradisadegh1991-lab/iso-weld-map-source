# Phase 9 — Spool & Cut List traceability: audit (Step 0)

Baseline: master `2c17be2` (Phases 1–8). Nothing in this document is a design decision yet; it records what the code does today.

## 1. Where cut pieces come from

| Source | Code | Fields produced |
|---|---|---|
| LLM extraction (CUT PIPE LENGTH table) | `app/api/extract/route.js` (schema at l.94), merged by `lib/extraction/merge.mjs` (a pass's list wins whole: `a` if non-empty else `b`) | `piece`, `lengthMm`, `nps` |
| Local OCR | `app/api/read-local/route.js` l.84 (keeps only integer `piece` + finite `lengthMm`) | `piece`, `lengthMm`, `ns`/`nps` |
| Person (CutForm) | `components/CutForm.jsx`, state in `components/WeldListEntry.jsx` (`cutRows`) | `piece`, `lengthMm`, `ns`, `from`, `to`, `spool`, `angle`, `note` |
| Engine model (computed, not stored) | `lib/register/cut-list.mjs` `cutList()` | `no`, `spool`, `kind`, `nps`, `lengthMm`, `endA`, `endB`, `printed` |

Stored as `payload.cutLengths` (array) on the run. It is written back by the page draft (`WeldListEntry.jsx` l.152, only when non-empty) through `applyCorrection` (`lib/db/repos/review.mjs`), which diffs the payload generically (`diffPayload`) — cut rows are therefore persisted as opaque JSON, unknown attributes included.

## 2. Findings

1. **No cut piece has a stable identity.** There is no `uid`. A row is addressed by array index in the UI and by printed `piece` in checks/tests. `CutForm` enforces unique printed `piece` per sheet, but extraction (`merge`, `read-local`) does not.
2. **Ends and spool are printed numbers.** `from`/`to` hold weld numbers, `spool` holds a spool number string. `lib/register/cut-model.mjs` resolves them with `new Map(... m.no ...)` / `Set(m.no)` — a duplicate printed weld number collapses silently to the last one (`endSpools` Map), so a piece can be judged against the wrong weld.
3. **Weld → spool is a printed-number string** (`weld.attrs.spool` on sheet marks, `row.spool` on typed weld rows → `ROW_ATTR.spool`). A spool is a mark of kind `spool` with its own `uid` (Phase 2), but nothing refers to it by that uid. Renumbering a spool leaves welds and cuts naming the old number (`dependents()` in `lib/sheet/markup.mjs` l.498 only *reports* them at delete time; it matches by `no`).
4. **Weld rows have a uid** (Phase 4/6: `weldList[].uid`, `projectWelds`, `effectiveItems` in `lib/sheet/weld-projection.mjs`) and equipment already refers to welds by uid (`weldRefs`). Cut `from`/`to` do not follow that pattern.
5. **Duplicating** a mark (`duplicateMark`) drops `uid` and gives a new one; cut rows have no equivalent — a copied row is identical, including its (non-unique) piece.
6. **Validation today** (`lib/engineering/validation.mjs` l.301–304): `cutChecks` (printed-number checks, one `DI_CUT` finding each, keyed by the message text) and `cutVsBom` (`DI_CUT_BOM`, per size, metres vs BOM pipe rows). Findings carry no `entityUid` for cuts.
7. **BOM consumption** (`lib/register/cut-bom.mjs`): aggregate per size only; a cut is never tied to a BOM PT row, and the allocation ledger (`lib/register/bom-allocation.mjs`) has no cut or spool owner kind.
8. **Revisions**: `lib/revision/revision-diff.mjs` `CARRY_FIELDS` cover weld/spool/support/equipment marks. `cutLengths` are neither compared nor carried, and the weld `spool` field is carried as a printed string (target spool may be renumbered/absent).
9. **Existing guards to keep**: weld uids are registered to one document (migration 105); `reconcileMarks` never lends an identity on ambiguity; `RUN_LOCKED`/`assertEditable` forbid editing approved runs.
10. **Mark numbers are not unique by type**: typed lists refuse duplicate weld numbers, but sheet-mark duplicates are possible (Phase 7 `SUP_DUP`/dup-number findings), so number → entity resolution is only safe when unique.

## 3. Data-flow summary

```
extract / OCR ──► payload.cutLengths [{piece,lengthMm,nps|ns}]      (no uid)
person (CutForm) ─► + from,to,spool,angle,note (printed numbers)
sheetMarkup.items  weld{uid,no,attrs.spool="SP-1"}  spool{uid,no}   (spool by printed no)
weldList[]         {uid,no,spool="SP-1",…}                          (spool by printed no)
cutChecks(): from/to/spool resolved by printed no   cutVsBom(): per-size metres only
```

## 4. Constraints for the design (from the audit)

- Reuse `isUid`/`newUid`/`ensureUids` (`lib/sheet/mark-identity.mjs`); no second registry.
- Additive only: legacy `from/to/spool` printed fields stay readable and are preserved.
- `reconcileMarks`-style rule for legacy resolution: resolve a printed number only when it names exactly one entity; otherwise structured warning, never a guess, never geometry.
- Extraction output must not be silently changed; user corrections need to stay distinguishable from extracted values.

## 5. Identity and relationship contract (as built)

No new registry and no migration: `isUid` / `newUid` of `lib/sheet/mark-identity.mjs` are reused; the new pure module is `lib/register/cut-identity.mjs`.

| Entity | Identity | Reference stored | Printed number |
|---|---|---|---|
| Cut piece | `cutLengths[].uid` (UUID, born with the row, kept by edit/save/reload; a copy gets a new one) | — | `piece` (label) |
| Start / end weld | weld uid (typed row or sheet mark of THIS revision) | `fromUid`, `toUid` | `from`, `to` (refreshed from the weld) |
| Spool | spool mark uid | `spoolUid` on the piece and on each weld (`row.spoolUid` / `attrs.spoolUid`, round-trips through `EXTRA` in `lib/sheet/weld-list-marks.mjs`) | `spool` (refreshed) |

Rules enforced (pure `settleCuts` / `settleWeldSpools`, run inside `prepareSheetPayload`, i.e. in the same transaction of `/api/runs` and `applyCorrection`; the page runs the same label refresh while editing):

* a legacy printed reference becomes a uid only when exactly ONE entity of the revision has that number; several → `ambiguous` (nothing set, structured finding `CUT_REF_AMBIGUOUS` / `WELD_SPOOL_AMBIGUOUS` with the candidates); none → `unresolved`;
* a uid that names nothing in this revision is `dangling` (error finding, kept as written — no automatic cleanup, no re-resolution by number): this is the revision boundary;
* renumbering / moving a weld or renumbering a spool changes labels only; geometry is never read;
* a spool's welds are a VIEW of the welds' `spoolUid` (`spoolView`), so membership cannot disagree with the welds and a weld cannot belong to two spools; moving a weld = `assignWeldSpool` (uid unchanged, label and uid change together); a field weld needs no spool;
* duplicate piece (`duplicateCut`): new uid, next piece number, `uid/status/orig/src` not copied; duplicate spool/weld marks already get a new uid (`duplicateMark`) so a copied spool owns nothing;
* edits keep every unknown attribute; for a piece read from the sheet (`src` ≠ `"hand"`) the first value of `piece/lengthMm/ns` a person changes is kept once in `orig` (source vs correction); derived values (totals, remaining, status) are computed, never stored; validation findings are computed.

## 6. Cut model, BOM consumption, validation

* `lib/register/cut-model.mjs`: `cutIssues()` (structured, UID-first) and the old `cutChecks()` contract on top of it.
* `lib/register/cut-bom.mjs`: `cutBomReport()` (new) and `cutVsBom()` (old shape). Groups by size, and by material grade / schedule where BOTH sides say it (BOM grade/schedule are read from the row's description by the existing `gradeOf`/`scheduleOf`; a piece or row that does not say it is compatible with anything). Units: `m`, `mm` (converted); any other unit is not a length. Same-uid / identical pieces count once. Tolerance unchanged (0.05 m). `remainingM` is theoretical and is labelled as such; groups that can use the same BOM rows are also checked together so one row is not spent twice. Draft results are labelled PREVIEW (`detail.preview`, the UI text); the server's saved BOM is the authority.
* New optional USER-entered piece fields: `material`, `schedule` (never extracted, never invented).
* Validation Center (`lib/engineering/validation.mjs`, no second engine): `CUT_NO_UID, CUT_DUP_UID, CUT_DUP_PIECE, CUT_LENGTH_INVALID, CUT_ANGLE_INVALID, CUT_END_MISSING, CUT_END_DANGLING, CUT_END_UNRESOLVED, CUT_END_UNPLACED, CUT_REF_AMBIGUOUS, CUT_SAME_END, CUT_SPOOL_DANGLING, CUT_SPOOL_UNRESOLVED, CUT_SPOOL_MISMATCH, CUT_BOM_OVER, CUT_MATERIAL_MISMATCH, CUT_SCHEDULE_MISMATCH, WELD_SPOOL_DANGLING, WELD_SPOOL_AMBIGUOUS` (+ existing `DI_CUT_BOM` for no-pipe-row / size-not-read). Each has a stable id, entity uid, revision, explanation, suggested action; none is `blocking` (the server refuses none of these operations).

## 7. Revisions

`lib/revision/revision-diff.mjs` compares cut pieces (added / removed / modified length, size, material, schedule, angle, endpoints, spool, piece number) and a mapped weld's spool relationship (by uid). Identity: explicit pair only; a unique printed piece number is a `candidate`; several are `ambiguous`; length/size/position never pair. Endpoint and spool changes are judged through the existing weld/spool mappings, so renumbering is not a change. Carry (`ns, material, schedule, angle, note, from, to, spool`): only into EMPTY target fields, references only as the target's own uid through mappings and only if that entity exists in the target, never `piece`, `lengthMm`, `uid`, status or history; a result that would give both ends the same weld is not offered.

**Migration decision: none.** `revision_carry_map.cls` has a CHECK (`weld|spool|support|equipment`, migration 106), so a cut pairing cannot be stored there without a migration. The pairs a person confirms are kept in the carry operation that applied them (`revision_carry_op.summary.cutPairs`, append-only like the operation; uniqueness enforced in code in `cutPairsFor`/`carryForward`). A later migration 107 widening the CHECK would move them to the map table; it is NOT needed for this phase and nothing was run or deployed. **Migration 106's production status remains unverified; it must be deployed by its own controlled procedure before the Phase 8/9 revision features are used on a server.**

## 8. UI

`components/CutForm.jsx` (uid pickers with printed label + short uid, legacy/ambiguous/dangling state shown, material/schedule), the cut table in `components/WeldListEntry.jsx` (search, filter, sort, validation indicator, add / view / edit / duplicate / delete with a dependency preview, selection sync with the drawing both ways, navigation to start/end weld and spool), `components/SpoolDetail.jsx` (number, uid, welds by uid with shop/field counts, cut pieces, total length, size/material/schedule breakdown, BOM consumption preview, findings), `components/MarkForm.jsx` (a weld's spool is picked by uid). `dependents()` is uid-aware and lists cut pieces when a spool or weld is deleted.

## 9. Verification (what actually ran)

* `db/test/spool-cutlist.mjs` — 40 tests (identity, relationships, BOM, validation, server save/reload/renumber/boundary/ambiguity, revision compare + carry); in the `db:test` chain. PGlite and real PostgreSQL 16 (also `revision-lifecycle`, `engineering-validation`, `npm run db:test:pg`).
* `npm run db:test` full chain, `npm run eval:check` (GATE PASSED), `npx next build`: see the PR.
* Guards proven by reverting the code they protect (legacy "first of several" guess → I4, R3, R6, S5 fail; repeated uid kept → I1; auto-pairing by piece number → T1, S6–S8; labels not following uids → I5, R4, S3).
* `tools/drive-spool-cutlist.mjs` — real browser on a real sample PDF, 40 checks (create piece by uid, save, reopen, renumber a weld, renumber the spool, duplicate, BOM consumption and material mismatch, ambiguous legacy sheet, revision compare, light/dark, phone). Screenshots in `docs/audit/phase-9-shots/`.

## 10. Deferred items and risks

* No migration (see §7). Cut pairs live in the carry operation's summary; moving them to a table needs migration 107.
* Equipment's `spool` attribute is still a printed label (not made uid-based); out of this phase's scope.
* Spool deletion: the UI lists welds and cut pieces that rest on it and the Validation Center flags what is left dangling; there is no server-side refusal and nothing is detached automatically (a deliberate non-destructive choice).
* `weld.spool` in the DB register (derived from the typed list) can lag one save behind a spool renumbering made through the API only; the page refreshes the labels before saving, and the payload stored by the server is always settled.
* Pieces read from the sheet have no `src`; they are treated as "extracted" for the `orig` record. Existing payloads are not rewritten until saved.
* BOM schedule is recognised only in the `SCH n / STD / XS / XXS / n mm` forms of the description (the `S40` form is unknown, so compatible with anything). Material is the existing grade regex.
* Placement of an end weld is informational (`CUT_END_UNPLACED`, info) because no project rule requires it in the schema.
* Nothing here changes extraction, geometry, BOM capacity rules, authorization, or the revision lifecycle contract.
