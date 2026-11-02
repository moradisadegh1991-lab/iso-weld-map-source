# 19 — Spools, supports and cutting as their own tabs

The owner's request (2026-11-02): spools, supports and cutting each get a tab of
their own beside welds, BOM and equipment, without changing the data model.

## Tabs

سرجوش‌ها · **اسپول‌ها** · **ساپورت‌ها** · تجهیزات · BOM · برش — each a table of its own
(the same component, `MarkTables` with one class), so the same fields, pickers, row
actions, platform table views and the sheet's right-click «edit» (which opens the tab
of the mark's class, its first field in focus) as before. A table of one class speaks
of its own class: the unattached-mark warning, the attach hint and the rules list are
those of that class (spool tab: the spool rules; support tab: the support rules).

The spool table gains one read-only column, **سرجوش‌ها**: the weld marks that name the
spool (count and numbers), from the sheet — nothing stored, nothing added to the model.

## Cutting against the BOM (lib/register/cut-bom.mjs)

The «برش» tab shows the printed CUT PIPE LENGTH table as before and, above it, per
pipe size: the pieces, their total length (m) and the metres the sheet's BOM lists as
pipe of that size. It says: **over** (the pieces add up to more than the BOM — beyond
the 0.05 m the sheets' own rounding gives), **no BOM row** (a size with no pipe row in
metres), **size not read**. More BOM than cut is normal (lengths bought whole, a run
that ends on the next sheet) and is not flagged. A problem turns the tab's badge red.
It states where the numbers disagree; it does not decide which is right.

## Not changed

No schema, API or engine change. The cut pieces of the engine's own model (the
model-based route) and their spool and angle are as before; editing cut entities, a
cutting angle and a cut-to-spool relation are a model change and a separate decision.

Tests: db/test/cut-bom.mjs; each guard turned off, its test fails.
