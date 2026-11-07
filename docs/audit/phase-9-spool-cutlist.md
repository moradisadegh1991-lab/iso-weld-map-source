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

## 5. Open items

- The Phase 9 brief received for this audit ends mid-sentence in Step 3 ("Deleting a spool with dependent cut pieces or welds mu…"); Steps 4+ were not available. Implementation waits for the full text.
