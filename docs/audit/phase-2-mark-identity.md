# Phase 2 — Stable mark identity and revision-safe reconciliation

Branch `feat/stable-mark-identity`, from `master` at `9f30e4c` (Phase 1 persistence unification). Migration **105**.

## 1. Architecture found (before the change)

* A sheet mark is `{ id, kind, no, x, y, ax, ay, attrs, src }` in `payload.sheetMarkup.items` (`lib/sheet/markup.mjs`). `id` is **`withIds`: `m1`, `m2`… in list order** for any mark without one.
* A re-extraction builds the engine's marks again (`fromEngine` → `withIds`) so every one is numbered from `m1` again; the page keeps hand-made marks (`src !== "engine"`) and replaces the engine ones (`app/piping/page.jsx` ~948).
* Operational records pointed at that handle: `iso_equipment.mark_id` (unique with the document), `iso_equipment_weld.weld_ref`, `bom_allocation.owner_ref` (`ledgerDemands` → `weldDemands`/`pieceDemands` used `m.id`). After a weld is added or dropped, `m3` is another weld and an allocation or an installed valve follows the handle to the wrong mark.
* `bom_allocation_event` (migration 104) snapshots `owner_ref` — immutable.
* Weld identity across revisions already exists for the *register* (`weld_uid`, `matchRegisters`); marks had nothing.
* The typed-weld-list page (`WeldListEntry`) saves only spool/support marks in `sheetMarkup` (welds live in `weldList`), so it creates no weld/equipment dependents.

## 2. The identity contract (`lib/sheet/mark-identity.mjs`)

| concept | field | stable? | used for |
|---|---|---|---|
| persistent identity | `uid` (UUID) | **yes** — never regenerated | what equipment, accessories and allocations refer to |
| legacy handle | `id` (`m1`…) | no | the page's row key / selection; kept for compatibility |
| printed number | `no` | no (people edit it) | reading, matching |
| drawing revision | `document_id` | — | a uid belongs to exactly one |
| cross-reference key | `ownerKey(m)` = `uid`, or `id` for a mark that has none yet | | `iso_equipment.mark_id`, `iso_equipment_weld.weld_ref`, `bom_allocation.owner_ref` (same text columns) |

Guarantees (tested): a mark is born with a uid (`withIds`, `addMark`); moving, editing attributes, renumbering, `normalize`, JSON round-trips keep it; **a duplicate gets a new uid and copies the attributes**; a uid already used earlier in a list is not given twice; deleting a mark gives its uid to no one; a revision's marks are its own (a uid registered to one document cannot be registered to another).

Geometry is never an identity (position plays no part in matching).

## 3. Reconciliation (`reconcileMarks`, server wrapper `reconcileSheetMarks`)

Run when a sheet is saved or a run corrected, against the marks **of the same drawing revision**'s last *successful* run (a failed extraction has no marks to speak of and never stands for valid ones). A *new revision* is a new document: its marks are new marks.

1. A mark whose uid is a saved mark's keeps it (a second one carrying it is a copy and gets its own). A hand-made mark with a uid nobody knows is a new mark already identified.
2. Every other mark (engine-made, or without a uid) is matched to the saved marks nobody claimed by **class + printed number** (`plainNo`):
   * one saved, one new, no conflicting size → **matched** (takes the saved uid);
   * several on either side → only an exact one-to-one match on kind/size/type/spool is trusted;
   * anything else → **ambiguous**: the new marks get **new** uids, nothing is lent, and a warning is returned and recorded (`sheet_mark_warning`).
3. The rest are **created** (new uid). Saved marks nothing claims are **removed**: reported, never reassigned.
4. **Safe resolution path:** an ambiguity that touches a mark with something *installed or tested* behind it (equipment, an installed accessory, an installed allocation) is refused (**409 `MARK_IDENTITY_AMBIGUOUS`**, nothing changes) with the numbers and the way out — settle the numbers/attributes on the sheet, or send the right mark's `uid` explicitly (an explicit, known uid is always trusted). Otherwise the save proceeds with new uids and the warning stays open until someone resolves it (`resolveMarkWarning`, requires a note).
5. `registerMarks` records every uid in `sheet_mark_identity` (PK uid → project, document); one already registered to another revision is **409 `MARK_UID_CONFLICT`**. The registry is insert-only for the application role.

Wiring: `POST /api/runs` locks the document row, settles identities against the last successful run, stores the settled payload, then `persistRegister` → `syncSheetData` (Phase 1) registers the marks and syncs equipment (keyed by uid) and the ledger (`ledgerDemands` owners are uids). `applyCorrection` settles against the run's own pre-correction marks before the payload is stored. Responses gain an additive `markIdentity` (`kept`, `matched`, `created`, `removed`, `ambiguous`) when anything was settled.

## 4. Migration 105

* `legacy_mark_uid(document, "m3")` — md5 of `document:m3` laid out as a v4 UUID; the JS `legacyMarkUid` is identical (tested against the SQL on both engines). A saved mark with no uid is given exactly this identity when it is read, so the old handle and the migrated references line up.
* `iso_equipment.legacy_mark_id` keeps the old handle; `mark_id` becomes the identity. `iso_equipment_weld.weld_ref` and `bom_allocation.owner_ref` (kinds weld/equipment/accessory) are rewritten the same way. **`bom_allocation_event` is not touched** (immutable): its snapshot keeps the handle the event was made under.
* `sheet_mark_identity` registers every identity in use; `sheet_mark_warning` holds open ambiguities.
* Idempotent: only references that are not UUIDs are rewritten; a second run changes nothing (tested). No table is rebuilt; nothing is deleted; RLS is lifted only for the statements (as 012/102–104) and restored.
* **Rollback considerations:** additive columns/tables and an in-place rewrite of three reference columns. To go back: set `mark_id`/`weld_ref`/`owner_ref` from `legacy_mark_id`… only `iso_equipment` keeps the old handle; for the other two the old handle is not recoverable from the new value (md5), but each corresponds to the `legacy_mark_id`/mark list of the saved payload. Restore from the pre-update backup (`sudo epc backup` runs first) rather than reversing in place.

## 5. Legacy compatibility

* A payload with no uids is still accepted and read; the first save settles identities (matched against the revision's previous marks, or the deterministic legacy identity for previous marks that had none).
* `id` is kept on every mark; the page uses it as before. `uid` is an extra field that `normalize` keeps (a malformed one is replaced).
* Items without a uid still sync (`ownerKey` falls back to `id`) — old callers and the existing tests that build marks by hand keep working.
* `listEquipment` returns `markId` (now the identity) and the new `legacyId`.

## 6. Tests

New: `db/test/mark-identity.mjs` (20: pure rules, route handlers end to end, migration 105 over data), `db/test/mark-identity-concurrency.mjs` (3, PostgreSQL). Changed: `sheet-markup.mjs` (a copy has its own identity), `register-persistence.mjs` (fixtures carry uids).

| Required | Where |
|---|---|
| 1 new mark has an identity · 2 normalisation · 3 serialisation | `1,2,3.` |
| 4 move · 5 attribute edit · 6 renumber | `4,5,6.` |
| 7 duplicate → new identity · 8 copies attributes | `7,8.` |
| 9 re-extraction preserves · 10 creates for new | `9.`, `10.`, and through `/api/runs` `12,13.` |
| 11 ambiguity lends nothing | `11.`; with warning + resolution: `an ambiguity with nothing installed…` |
| 12 deletion with installed dependents refused | `12. deleting a mark that something installed stands on…` (also the ambiguity refusal) |
| 13 equipment refs valid · 14 allocation refs valid after re-derivation | `12,13.` (same equipment row, ledger lines untouched, history shows no release/re-reserve), correction test |
| 15 revision boundary | `15.` (no inheritance; a stolen uid is refused) |
| 16 legacy readable and editable | `17.`, `16.` |
| 17 migration backfill on populated data · 18 second run safe | `18.`, `18b.` |
| 19 allocation history readable | `14,19.`, `18.` (events untouched) |
| 20 concurrent updates | `M1` (six racing saves ⇒ one identity per mark, one equipment row, one ledger), `M2` (one identity offered to two revisions ⇒ one owner), `M3` (registry insert-only) — PostgreSQL |

Guards proved by reverting: document lock removed ⇒ M1 red; the registry's revision check removed ⇒ `15.` red; the one-to-one matching rule removed ⇒ `11.`, `12.` and the warning test red.

### Results (this session, local; counts from each run's own output)

| run | passed | failed | skipped |
|---|---|---|---|
| `mark-identity.mjs` (PGlite) | 20/20 | 0 | 0 |
| `mark-identity.mjs`, `register-persistence`, `sheet-markup`, `bom-allocation`, `iso-equipment`, `review`, `api`, `bom-allocation-history`, `numbering` on real PostgreSQL 16.15 | 20/20, 13/13, 42/42, 18/18, 9/9, 23/23, 27/27, 5/5, all passed | 0 | 0 |
| `mark-identity-concurrency.mjs` (PostgreSQL, `PG_TEST_URL`) | 3/3 | 0 | 0 |
| `npm run db:test` (whole chain, PGlite) | 1438/1438 in 116 files, exit 0 | 0 | 0 |
| `npm run db:test:pg` (pg-scope 8, material-concurrency 15, bom-allocation-concurrency 5, mark-identity-concurrency 3) | 8 + 15 + 5 + 3, all passed | 0 | 0 |
| migration chain from an empty PostgreSQL 16 database | 107 applied (last: 103, 104, 105); re-run applies 0 | | |
| `npm run eval:check` | `GATE PASSED` | | |
| `npx next build` | exit 0 | | |

Three failures were met on the way and fixed, not skipped: (a) the repository's rule that every one-column primary key is generated by the database (`numbering.mjs`) — `sheet_mark_identity.uid` is deliberately supplied (the mark's own identity), so it was added to that test's documented allow-list with its reason; (b) and (c) two earlier-phase migration tests that asserted the exact list of migrations applied after theirs (now "includes"). A full `db:test` stops at the first failing file, so the files after each failure were re-run in the final pass above.

Not executed: GitHub Actions on this branch (not pushed), the browser/UI drives, a managed PostgreSQL.


## 7. Remaining risks and unresolved ambiguities

* A weld renumbered by the engine *and* edited at once, with no uid anywhere (an old payload), can be unmatchable: it is reported as created/removed (or ambiguous), never guessed.
* The typed weld list (`WeldListEntry`) rebuilds weld marks from rows, so a weld mark there has no uid across sessions; it has no sheet-markup dependents today, so nothing hangs on it.
* Identity does not carry across drawing revisions (by design); there is no lineage link between revision 0's mark and revision B's.
* Migrating a legacy handle that was already wrong (an allocation that followed a shifted `m3`) preserves the wrong link — no ambiguity is invented, but none is repaired either; those need the normal "return and re-reserve" correction.
* `sheet_mark_warning` has a repository API (`markWarnings`, `resolveMarkWarning`) but no route or screen yet.
* Not executed: GitHub Actions on this branch (not pushed), the browser drives, a managed PostgreSQL.

## 8. Files

`lib/sheet/mark-identity.mjs` (new) · `lib/sheet/markup.mjs` · `lib/register/bom-allocation.mjs` · `lib/db/repos/mark-identity.mjs` (new) · `lib/db/repos/register-persistence.mjs` · `lib/db/repos/iso-equipment.mjs` · `lib/db/repos/review.mjs` · `app/api/runs/route.js` · `db/migrations/105_stable_mark_identity.sql` (new) · `db/test/{mark-identity,mark-identity-concurrency}.mjs` (new) · `db/test/{sheet-markup,register-persistence}.mjs` · `package.json` · this document.

## 9. Deployment

`sudo epc backup && sudo epc update` (migration 105, its own transaction).
