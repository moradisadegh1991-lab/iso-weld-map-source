# 14 — Picking lists and the platform table on the isometric page

The owner's request (2026-11-01): every table of the isometric and weld-list
page behaves like the platform's other tables (table, grid and cards, with
search, filter, sort, export), and every column a person does not have to
type is picked from a list kept on one page, so the work goes faster.

## The tables

Every table on /piping is inside `TableKit` (components/ui/TableKit.jsx):
the weld/spool/support marks, the typed weld list, the sheet's BOM and cut
table, BOM welds, the engine register, nodes, MTO, the meta list, the cut
list, the review queue, the edit diffs and log, the truth comparison and the
equipment tags. The editable tables keep their own fields; the kit adds the
views and tools around them.

## The lists

lib/register/value-lists.mjs names 15 lists, each with built-in values;
/piping/defaults («مقادیر پیش‌فرض جدول‌ها») replaces a list's values for the
project (`value_list`, migration 096; saved whole, in the person's order;
back to the built-in values with one button). Changing them takes the
piping-class right; everyone on the project sees them.

| Picked from a list | Typed by hand |
|---|---|
| weld location (fixed: Shop / Field), joint type, size (NPS), schedule, material, WPS, support type, piping class, unit, BOM group, test fluid, NDT, PWHT, paint, insulation type; a weld's spool from the spools on the sheet | weld / spool / support / PT numbers, drawing, sheet, revision, line number; lengths, quantities, pressures, temperatures, insulation thickness; description, note, stock code, Tie-in reference |

A value read off a sheet that the list lacks is kept and shown first, marked
«خارج از فهرست»: a list offers values, it never changes one already given.
A list with no values yet (WPS, support type, piping class, unit, until the
project fills them) is typed into as before.

Tests: db/test/value-lists.mjs (each guard turned off, its test fails).
