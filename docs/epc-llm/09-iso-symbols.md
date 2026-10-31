# 09 — Isometric symbols, and what the no-model reader reads besides the welds

## The two references

The model's prompts (`app/api/extract/route.js`, `ISO_SYMBOLS`, in the meta,
nodes, repair, welds and sheet-marks passes) name what may be drawn on an
isometric after two public references:

| Source | What it gives |
|---|---|
| Wermac, *Mechanical symbols for Isometric drawings* — https://www.wermac.org/documents/symbols_iso.html | The symbol of each fitting, flange and valve for each end type (fittings: butt weld, socket weld, threaded; valves: butt weld, flanged, socket/threaded). Fittings: elbow 90/45, tee equal/reducing, cap, reducer concentric/eccentric. Flanges: welding neck, socket weld, threaded, slip-on, lap-joint, blind. Valves: gate, globe, Y-globe, ball, plug, butterfly (wafer), needle, diaphragm, three-way, check, bottom, relief, control straight/angle. Miscellaneous: Weldolet, Nipolet, Flangolet, spade, spectacle and hammer blinds, spacer, restriction orifice, field weld, butt weld, pipe-to-pipe connection, special-radius bend, sight glass, hand-wheel direction, Y and conical strainers, orifice assemblies. "Symbols are shown in black lines. Lighter lines show connected pipe." |
| AQC Inspection, *Pipe Line Isometric Drawings and P&ID Drawings* — https://aqcinspection.com/pipe-line-isometric-drawings-and-p-id-drawings/ | An isometric is a single-line drawing of the line with its connections, dimensions and direction; the direction symbol is on top; a line number holds for the whole line until it joins another line or equipment; a spool number is a fabrication sub-division joined on site; a rolling/offset is a right-angled triangle hatched vertically, horizontally or both. |

Both pages draw the symbols as images; their text names them and does not
describe the strokes. Neither page says how a shop weld is told from a field
weld beyond "Field Weld" having its own symbol, nor anything about supports,
the title block, the BOM columns or the line data. So the prompts name the
symbols and leave **shop / field to the project's declared frame shapes**
(project › specifications › weld symbol on isometric) and the engine — the
model reads the shape, it never decides.

## What the no-model reader reads (tools/iso-read.py)

Besides the weld frames, spool ovals and support hexagons
(08-no-model-reader.md), the reader now returns (a sheet takes about 34 s
instead of 25 s):

- **`bom`** — the FABRICATION / ERECTION MATERIALS table, found by its header
  line (a QTY and a DESCRIPTION word); each word goes to the column it stands
  under. A row starts at its PT number; a line with no PT number continues the
  description above it, unless it is a group heading (PIPE, FITTINGS, …).
  `diam` ("6", "6 x 3/4") and `qty` (with `qtyUnit` m or pcs) are kept only
  when they read as such; the description and item code are the OCR's text.
  A PT number read twice is dropped.
- **`lineData`** — the title block's line data, each value the words beside
  its label inside the label's own cell, kept only when it fits its field's
  pattern: design and operating pressure and temperature (a "DESIGN" label
  takes its meaning from the PRESSURE or TEMPERATURE heading above it), test
  fluid and pressure, line class, insulation type and thickness, paint, NDT,
  PWHT. The **line number** is kept only when the title block's LINE NO. cell
  and the file label at the sheet's corner, `(ISO-aa-nnnn)/<line>`, read the
  same, each read several ways (cell_vote).

Anything not read for certain is `null` — UNKNOWN is never a guess. In the
app the line number and class prefill the weld-list form, the BOM sets the
joint type where the sheet's BOM allows only one at that size
(lib/register/weld-marks.mjs), and both are shown beside the form for a person
to check and are saved with the run.

- **`cutLengths`** — the CUT PIPE LENGTH table, in one or two side-by-side
  halves each under its PIECE / CUT / N.S. header: `{piece, lengthMm, nps, ns}`.
  A length stands only when its cell, read again several ways on its own,
  says the same; a size only when it is a nominal size and its cell read on
  its own agrees.

Numbers stand only when they are read for certain: a figure read once can
drop a minus sign ("-5" read "5" on 25-1002), a slash ("3/4" read "34") or a
whole part ("1.1/2" read "1/2"). Each of those is now read again on its own
cell, several ways, and kept only when the readings agree — otherwise it is
left for a person. Each guard was turned off and the wrong value came back.

Measured (`npm run eval:reader`, 54 golden sheets; the weld markers unchanged
at 799/804 found, 0 invented):

| | |
|---|---|
| BOM, against the project MTO each sheet carries (49 sheets, 511 rows) | 440 rows matched by description; size right 353, printed otherwise than the MTO writes it 61 (the sheet prints "2 x 3/4" for a branch coupling the MTO lists as 3/4; a bolt's length is in its description), **wrong 0**, unknown 26 |
| Cut lengths, three tables transcribed by eye (eval/cases/reader-cuts.json, 23 pieces) | 20 found, 0 invented; length right 20, **wrong 0**; size right 19, **wrong 0**, unknown 1 |
| Line data (no transcription yet) | values read on 54 sheets: design temperature 51, test fluid 53, line class 49, NDT 48, paint 46, operating temperature 43, design pressure 33, operating pressure 30, insulation type 32 and thickness 22, test pressure 12, line number 11, PWHT 0; spot-checked by eye on four sheets (25-1002, 25-1012, 25-1031, 25-1020 SH1): no wrong value |

On the example sheet 25-1020 SH1 the BOM reads 20 of 20 rows, every size and
quantity right, and the line data reads all twelve printed values and the line
number; on its sheet 4 the cut table reads all 8 lengths right.

## The OCR route drawn as the engine's

With the drawing beside the weld-list form, the form is the engine's sheet:
one table of welds, spools and supports (components/MarkTables.jsx) and the
marked sheet (components/SheetMarkup.jsx), each weld row one mark
(lib/sheet/weld-list-marks.mjs), plain numbers in the frames, a leader from
every mark a person joins to its weld point, and at each row's end
«اتصال به نقشه» / «جابه‌جایی روی نقشه» / «برداشتن از نقشه» / «حذف». A row not
joined to the drawing is named above the table. The rows are still the
register that is checked, saved and approved.

Next (not in this change): finding the weld points on a sheet with no printed
weld numbers, measured on the golden sheets first.
