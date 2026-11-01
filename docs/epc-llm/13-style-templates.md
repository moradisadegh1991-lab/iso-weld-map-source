# 13 — A saved template per drawing style

The owner's choice (2026-11-01): «automatic, plus a saved template per
style». The automatic part reads a title block by its labels
(11-drawing-styles.md). A template is what a person adds once for a
designer's style: **where** each value is printed, so that a later sheet of
that style is read from those cells too — a style whose labels the reader
does not know, or a value its labels do not lead to.

## What a template holds, and what it does not

- `fingerprint` — the words that sheet's title block prints (its labels and
  headings), as the reader read them. A later sheet whose words are at least
  half the same (Jaccard ≥ 0.5) is read by the template; on the example
  set, the other pages of the style are 98–100 % alike.
- `fields` — for each value the person marked, its cell on the page: a box
  as fractions of the page as rendered (migration 095, `drawing_style`).
- **Never the value.** Each sheet's own cell is read, four ways, and the
  value kept only when the readings agree — as everywhere in the reader.

## How a sheet is read with it (tools/iso-read.py)

On a sheet of another style (`style: "generic"`), after the labels are read:

1. the saved template most like the sheet's words is chosen, if any is
   like enough;
2. each marked cell is cut from the 600 dpi page and its **ruled lines
   removed** (ink across nearly the whole box: a box drawn by hand catches
   the cell's border) — with them left in, the test pressure 11.1 read **4**
   (one reading fit the pattern, the other three read nothing);
3. a value the labels did not read is taken from the template; a value both
   read differently is **neither** — it is unknown and named as a conflict.

Measured alone (`--template-only`, for `eval:styles`), the template stands
in for the labels entirely.

## In the app

Beside a sheet read with no model in another style
(components/StyleTemplate.jsx):

- which template it was read by, how alike, what each of its cells read, and
  any conflict with the labels;
- «الگوی این سبک نقشه»: choose a value, «نشان دادن خانه روی نقشه», click two
  opposite corners of its cell on the sheet (zoom 1–4×); the boxes are shown
  on the sheet; name the template and save. Saving the same name replaces its
  cells. The project's templates are listed, each can be deleted
  (app/api/drawing-styles; reading and marking take the right to run an
  extraction).

## Measured (`npm run eval:styles`, the CWR set, pages 1, 7, 9, 13)

The template was marked on page 9 as a person would
(eval/cases/styles/cwr-andimeshk.template.json, 15 cells):

| Line data (36 values) | right | wrong | unknown |
|---|---|---|---|
| labels alone (a vector page's line number and unknown cells read off its strokes, 11-drawing-styles.md) | 36 | **0** | 0 |
| template alone | 28 | **0** | 8 |
| labels and template | 36 | **0** | 0 |

The template reads the **test pressure 11.1 on all four pages** — three of
them not the page it was marked on — where the labels' cell gave two readings
(11.1 / 14.1). Title block (sheet, revision) 8 of 8 either way; the BOM and
cut table are read as before.

With the labels and the page's strokes, nothing of the line data is left
unknown on these four pages; the template alone leaves NDT and the line
number (a cell's place does not change how its glyphs read — the strokes do).

**How exactly the box is drawn matters**, and the answer is then unknown,
never a near value: in the browser the test-pressure box was drawn half a
thousandth of the page off the one measured above, and on page 13 its
readings split again (11.1 / 14.1). Of four boxes tried around that cell, two
read 11.1 and two nothing. Two further rules were tried and turned off again,
each changing nothing on the example: two readings at least to agree, and
trimming dots at the box's ends (taken over the 150 threshold, it trimmed the
hairline "1"s of 11.1 and read **1**; that version was never kept).

## Not done

- A golden-layout sheet is not read by a template (its own reader reads it).
- The BOM and cut table are not marked in a template.
- A box is not snapped to its cell's ruled lines; drawn with the label's
  colon or across a cell border, a value is unknown.
