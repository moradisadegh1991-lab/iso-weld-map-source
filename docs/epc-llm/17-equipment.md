# 17 — Installation equipment: the triangle, its welds and accessories

The owner's request (2026-11-02): an installed item (valve, strainer, flange,
instrument…) on the sheet, joined to one or more welds, with accessories
(gasket, bolts, nuts) taken from the BOM — a triangle on the drawing, a row in
a table, a register in the database, and a ledger of what it takes of the BOM.

## One record, four places

The item is a **mark** of the sheet (`kind: "equipment"`, lib/sheet/markup.mjs):
a triangle drawn like the other marks (point up, label inside, a leader to its
place on the pipe), so the sheet, the equipment tab, the explorer, the
inspector and the right-click menu show and edit the same thing. Right-click the
empty sheet → «افزودن تجهیز نصب»; on the triangle → view, edit, copy (with its
welds and accessories), move, delete (says what refers to it).

Its attributes: type (a project list, /piping/defaults), tag, the **BOM row it is**
(picked from this sheet's BOM, with a snapshot), the spool it stands in (picked
from the sheet's spools), the **welds it joins** (picked from the sheet's weld
numbers, as many as it joins), its **accessories** (rows of the same BOM, with
quantities: «PT×qty») and its installation status (planned, delivered,
installed, tested). `equipmentChecks` warns — never corrects — when its BOM
row, a joined weld, its spool or an accessory is not on the sheet.

## The register (migration 098, lib/db/repos/iso-equipment.mjs)

`iso_equipment` (one per mark of a drawing revision), `iso_equipment_weld`
(which welds it joins — the weld mark's id), `iso_equipment_accessory` (BOM
row, quantity, and **its own** installation status). Keys, unique constraints
and RLS; no blob. (Named `iso_*`: the plant's equipment register is another thing.)
Made to match the marks when the register is saved, in the same transaction as the
run. An equipment installed or tested — or with an installed accessory — is not
dropped by a save (409): return its status first. An accessory's status is set
through `/api/iso-equipment` (POST) apart from its equipment's.

## What it takes of the BOM

The allocation ledger of docs 16 now carries owner kinds `equipment` (its own BOM
row, one) and `accessory` (each, its quantity). They draw on the row's **quantity**,
apart from the welds' ends: two valves of a row of two, a third refused; 16 studs
for two flanges of 8, a ninth refused — the database's trigger, the sheet's warnings
and the page agree. Removing an equipment releases its lines with a recorded reason.

Tests: db/test/iso-equipment.mjs (register, joins, accessories, ceiling, rollback,
installed protection, routes) and db/test/sheet-markup.mjs; each guard turned off,
its test fails.

## Not here

A stand-alone spool/equipment-to-spool relation table (the spool is a name checked
against the sheet's spools); accessory status has no screen yet (API only).
