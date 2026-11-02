# 15 — The sheet's right-click menu, and a weld's two BOM components

The owner's request (2026-11-02): work on the drawing itself — right-click a
mark to see, edit, copy, move or delete it; right-click the empty sheet to add
one there; and give each weld the two BOM components it joins.

## The menu (components/SheetMarkup.jsx)

| Right-click on | Menu |
|---|---|
| a weld, spool or support | View properties (picks it, opens the workspace inspector) · Edit (its row in the table, first field in focus) · Copy with all properties · Move on drawing (the next click is its new weld point; Escape cancels) · Delete… |
| the empty sheet | Add a shop weld / site weld / spool / support here — its weld point is the click, in the sheet's own 0..1 coordinates; its row opens for editing |

The menu opens by the pointer and stays inside the window; the menu key or
Shift+F10 opens it on a mark in focus; arrows, Home/End move through it,
Escape or a click outside closes it. A look-only sheet (an approved register)
offers View only. A right button on a mark never starts a drag.

- **Copy** (`duplicateMark`): everything the mark records — BOM components and
  their snapshots, spool, WPS, material, Tie-in reference — a new id and the
  next number written the way the sheet numbers that class (`nextNo`: SP-3 →
  SP-4, SW-2 → SW-3, 12 → 13), set a small step aside with its leader's shape.
- **Move**: the existing placement — only where it is changes.
- **Delete**: `dependents` names what still refers to it (a spool's welds, the
  welds giving a weld as their Tie-in reference) before the person confirms;
  nothing else is deleted with it, and the rules then show what is left
  pointing at nothing. The table's own Delete asks the same when something
  depends on the mark.

## A weld's two components (lib/sheet/markup.mjs)

Two new weld columns, **قطعهٔ ۱ / قطعهٔ ۲ (BOM)**, pick a PT row of this
sheet's own BOM (shown with its description and size). The PT is kept, and
beside it what that row was when picked (`c1s`/`c2s`, "description | size",
not a column). `componentChecks` warns — never corrects, never infers a joint
type — when:

- a component is not a PT of this sheet's BOM;
- the same PT is on both sides of a fitting the BOM counts once (pipe, or a
  fitting with qty ≥ 2, is fine: two pieces);
- the weld's size is not among a component's sizes;
- the BOM row changed since it was picked.

They ride on the weld list rows as the note does (lib/sheet/weld-list-marks.mjs),
are saved with the sheet's marks, and show in the inspector by their BOM row.
Marks saved before have none and read as before.

## Tie-in reference: suggestions, not a link

`ref` (اتصال به Tie-in) is the external point a Tie-in weld ties into — another
line or drawing — not another mark on this sheet (lib/register/weld-list.mjs,
match.mjs). It stays text, now offered from the references this sheet already
uses and its Tie-in welds; a new one is still typed. A cross-sheet Tie-in
register with stable ids is a separate piece of work.

Tests: db/test/sheet-markup.mjs (copy, numbering, move, dependents, component
checks, round trip); each guard reverted, its test fails.
