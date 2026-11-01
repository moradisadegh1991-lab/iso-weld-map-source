# 11 — Another designer's drawings: the title block read by its labels, then checked against what is on file

The owner's request (2026-11-01): a project has several piping designers and
their isometrics do not look alike, so the no-model reader must not work from
one layout. First the line list is read and checked against what the project
already has (is this isometric, line, sheet and revision registered?), then
the line and its line list are registered, then the BOM; the welds the BOM
implies come after (the next change).

## Two styles, told apart on the sheet

tools/iso-read.py first reads the sheet as the golden sheets are laid out
(HEDCO, 25-10xx: 08-no-model-reader.md, 09-iso-symbols.md). When that finds
no ISO number in its cell **and** fewer than three line-data values beside
its labels, the sheet is another style (`"style": "generic"` in the output),
and its title block is read by what its labels say rather than where they
are (`read_title_generic`):

- **a value in a grid** — a row label and a column heading: PRESS. (barg) by
  DESIGN / OPERATING, TEMP. (°C) by DESIGN / OPERATING;
- **a label and the words after it in its cell** — PRESS.TEST(barg):, TEST
  FLUID:, NDT:, PWHT:, PAINT CODE:, INSULATION TYPE: / THK.: — the label's
  words only, never "any words after it" (the first version's `TEST.*` took
  "11." of "11.1" into the label and read the test pressure as **1**);
- **a label over its value** — CLASS:, SHT.NO. ("3 OF4" → 3/4), the
  PROJECT DOCUMENT No. (the drawing number), and the revision: the topmost
  written row of the revision table's REV. column, only with a date printed
  in that row.

The cells are the title block's own ruled lines. Each value is read again on
its own cell four ways (two sizes, grey and two-level) and kept only when
every reading that fits the field's pattern says the same — the rule the
golden route already follows (cell_vote). Anything else is null.

**A vector page** (a CAD PDF with no image and no text layer, as these are)
is read at 600 dpi with its hairline strokes thickened: at the golden route's
200 dpi a single-stroke CAD font blurs (7.4 read 74, 2.3 read 7.3). The BOM
and the cut table are read on that page too, with the reader's sizes scaled.

## What is not read, and why

- **The line number** is printed large and runs over the REV: and A0 of the
  next cell (`60"-CWR-…-UCW` over `REV: A0`): in the picture the overprinted
  letters cannot be told from the cell's own, and its readings disagree or do
  not read as a line number (…-UCK, …-UGHESS). **On a vector page it is read
  off its own strokes** (`line_no_from_vector`): the page is converted to SVG
  (pdftocairo, poppler-utils as already installed), and a CAD PDF draws a
  piece of text all at once — the number's strokes follow one another in the
  drawing order, the overprinted cell's words were drawn at another time. In
  the number's band (from the LINE No. label's cell) the run of consecutive
  strokes that holds the tallest lettering is kept, cut where a gap wider than
  two letters follows (the same run also draws the sheet's "3 4"), drawn
  afresh and read four ways, its letters 22 and 30 px tall; it must read as a
  line number every way. Each of the two cuts turned off gave a wrong number
  (`…-UGHES` with every stroke of the band; `…-UCW14` with the sheet's digits
  kept). On the 4 pages: all four line numbers right. A page that is not
  vector, or is turned, is read as before.
- **The test pressure and NDT** in the picture of this font: two readings
  disagree (11.1 / 14.1 / 17.1; `10%RT+10%MT` with its % read as 0 or 2).
  **On a vector page a value left unknown is read off its cell's own
  strokes** (`vector_cell`): the strokes inside the cell the labels pointed to
  are drawn afresh, their letters 22 and 30 px tall, and read four ways. The
  CAD font's percent sign — one stroke the height of the letters and a small
  closed loop beside it, a shape no other character of a value has — is told
  by its shape (tesseract reads it 2 or 4 even drawn clean, and glyph by glyph
  it reads worse): the value is read in the pieces between, each the same
  every way, and joined by %. On the 4 pages: the test pressure 11.1 and NDT
  10%RT+10%MT right on all four. (Turned off on the example and changing
  nothing, so not kept: leaving out the cell's own rules; the four readings
  agreeing is the reader's rule everywhere and stays.)

- **The project document number** on these sheets is the package's
  (AISPC-10-DE-930-PI-ISO-0001 on every line's sheets). It is read and
  prefills the drawing number; the check below says when a sheet with that
  number and sheet is on file for another line.

## The BOM: PT numbers in order

A PT number read wrong is a row put under another number (PT 11 read 14 on
the 600 dpi page). Two guards, each turned off on the example and the wrong
row came back:

- the PT numbers run down the table in order: the rows kept are the longest
  rising run of them, the others dropped (`rising`);
- on a 600 dpi page each PT number is read again on its own cell and kept
  only when the readings agree.

## Checked against what is on file, then registered

With the sheet beside the weld-list form, «بررسی ثبت قبلی در سامانه»
(components/RegistryCheck.jsx → app/api/registry-check →
lib/db/repos/line-list.mjs `registryCheck`) says, before anything is saved:

- the drawing / sheet / revision: **new**, **registered** (with its register
  saved or approved — an approved one needs a new revision), or **another
  revision on file** (the one in force named; which revision is the later is
  the project's numbering, not decided here);
- a sheet with the same number and sheet saved on **another line** — the
  number is probably a package's;
- the line: registered or not, the line-list values the sheet would fill,
  and every value that **differs** from the line's.

On save (app/api/runs):

- the line (lineForRegister) gets its empty line-list values from the sheet
  (migration 094: design / operating pressure and temperature, test pressure
  and fluid, NDT, PWHT, paint, insulation thickness; text as printed, units
  as the sheet names them). A value on file is never written over; a
  difference comes back in the save message. Only on a line named by its own
  number — a drawing number standing in for it may be a package's;
- the sheet revision's BOM, as the person checked it, is kept in
  `iso_bom_row`, replacing what was saved before for that revision; an
  approved register's BOM is not rewritten (the save is refused already).

## Measured

`npm run eval:styles` — the 14-sheet set of the example drawings
(eval/cases/styles/cwr-andimeshk.json: pages 1, 7, 9 and 13 transcribed by
eye), and `npm run eval:reader` on the 54 golden sheets for no regression:

| | |
|---|---|
| Style told apart | the 4 transcribed pages read as another style; the 54 golden sheets all as the golden layout (drawing number right 54/54) |
| Title block (sheet, revision) | right 8, **wrong 0**, unknown 0; the drawing number (the package's) read on all 4 |
| Line data (line number, class, design / operating P and T, test P and fluid, NDT) | right 24, **wrong 0**, unknown 12 — the line number, test pressure and NDT on every page (above) |
| BOM rows | 36 of 42 found, 0 invented; size right 36, **wrong 0**; quantity right 35, **wrong 0**, unknown 1. Missed: PT 7 on two pages and PT 11 on three (their numbers do not read the same every way), PT 13 on one |
| Cut lengths | 2 of 8 pieces found, length and size right on both, 0 invented — this table's layout is mostly not read yet |
| Golden sheets (`eval:reader`) | unchanged: markers 799/804 found, 0 invented; BOM 443 rows matched (440 before), size wrong 0; cut lengths 20/23, wrong 0; weld points 103/103 |

Each guard turned off on the example and the wrong value came back: the test
pressure's label taking its words after it (11.1 read **1**); the BOM's PT
order and PT re-read (a row **PT 14** for the printed 11).

A sheet of this style takes about 50 s on the server (the 600 dpi page adds
some 25 s to the golden route's).

## Not done

- The line number printed over its neighbour cell (above).
- The saved template per style (the third change): a person's corrections
  of where a style prints a value, kept so the next sheet of that style is
  read from there.
- The welds a BOM implies (each fitting's ends), against the welds found (the
  next change).

The welds a sheet's BOM implies, beside the welds found: 12-bom-welds.md.

A designer's style can also be taught once, by marking where it prints each value: 13-style-templates.md.
