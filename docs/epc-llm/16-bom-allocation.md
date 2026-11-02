# 16 — Who uses what of the BOM: the allocation engine

The owner's request (2026-11-02): a BOM item must not be given to more welds
than it can serve — two flanges, two welds, a third is refused — with
reserve, install, return and a history, safe under concurrent saves.

## The rule (lib/register/bom-allocation.mjs)

A weld's two components (docs 15) are two welded ends. A BOM row serves:

| Row | Serves |
|---|---|
| a counted fitting | quantity × the ends its description says it welds (`piecesEnds`): a weld-neck flange 1, an elbow 2, a tee 3 — two flanges serve two welds, one elbow two |
| pipe, nipple (a length) | not counted per weld; its metres are allocated to a spool or a cut |
| a row whose ends are not stated, or with no quantity read | no ceiling — named, never guessed |
| a row with no joint (gasket, bolt, instrument) | none: a weld cannot name it |

On the sheet the picker disables a row with no end left, says why, and shows
what is left («مانده ۱/۲»); the BOM tab shows reserved/capacity per row; the
rules list names a row named by too many welds. Same numbers as the ledger.

## The ledger (migration 097, lib/db/repos/bom-allocation.mjs)

- `iso_bom_row.alloc_cap` — the welded ends the row can serve, set when the BOM is saved.
- `bom_allocation` — one line per owner and BOM row of a drawing revision: owner kind
  (weld / spool / equipment / accessory / cut), the mark's id, quantity, unit (pcs / m),
  status reserved → installed → returned, or reserved → released. Keyed by revision and PT,
  not by the BOM row's id (a save writes the BOM's rows again).
- `bom_allocation_event` — append-only history: who, when, before/after, the reason.
- **The ceiling is the database's:** a trigger locks the BOM row and refuses a line
  that would take more than is left. Welds draw on the row's welded ends, every other
  owner on its quantity (a bolt a weld cannot name can be an accessory's). Two saves
  taking the last one at once: one wins.
- **Saving the register** (app/api/runs, the same transaction): each weld's lines are made
  to match the sheet's marks — reserved, adjusted, or released with the reason
  «weld or component removed from the sheet». A line already **installed** is never
  released by a save (409: return it first). A smaller BOM over live lines, or a lost
  PT, is refused until they are released. A refusal undoes the whole save.
- **API** (app/api/bom-allocations): GET availability/lines/history; POST install, return
  (reason required) or release (reserved only, reason required; closed on an approved
  revision — installing and returning are site progress and stay open).

## Not here yet

Spool/cut allocations by length and an equipment's accessories use the same
ledger (the next changes). The ledger refers to a mark by its id on the sheet;
deleting a mark never deletes a line without a recorded release.

Tests: db/test/bom-allocation.mjs (rules, ledger, trigger, concurrency, API);
each guard turned off, its test fails.
