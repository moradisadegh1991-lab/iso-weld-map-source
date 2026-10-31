# 10 — Where each weld is on the pipe, read with no model

Phase 2 of the no-model reader (tools/iso-read.py `weld_points`): the place
of each weld on the pipe — the end of each printed frame's leader on a sheet
with weld numbers, and the weld dots on a sheet without them.

## What the drawings show

On the project's isometrics (HEDCO, 25-10xx) a weld is drawn as a **filled
dot on the pipe**, and each weld frame's leader ends on its dot. Measured at
300 dpi with a distance transform (the radius of the largest circle that fits
in the ink): a dot is about 5.4 px, the pipe's heavy line 2.8–3, a flow
arrowhead 6.4 and more, a leader 1–1.5. At 200 dpi — what the frames are read
at — a dot cannot be told from the sheet's border line, so the page is
rendered again at 300 dpi for this.

Not every weld has a dot: some sheets draw none (25-1001), and threaded
(THD) and small-bore socket joints usually have none.

## How

- **Dots**: ink whose inscribed radius is 4.3–6.3 px, in a blob no more than
  16 px across, not inside a frame, a spool or support tag, a table, the
  title block or the materials panel.
- **A frame's weld point**: every line that leaves the frame (the frames'
  own outlines erased first, so a stack of touching frames is not a leader)
  is followed in a straight line until it meets the pipe's heavy line or a
  dot — with one bend at most — and the shortest such leader wins; the end
  snaps to a dot within 14 px. Short thick shapes (a fitting's body) count
  only beyond the frame's own label, so a leader does not end on the bold
  "THD" printed beside it; and the pipe reached further along the same line
  wins over a crossing of two thin lines passed on the way. A frame whose
  leader is not followed to the pipe has **no** weld point — also a frame in a
  stack drawn without a leader of its own: it is a weld of its own, with its
  own dot, not the stack's point.
- **A sheet with no numbers printed**: the dots on the pipe (a ring round
  each crosses the pipe's heavy line; none near the page's edge) are the
  candidate welds.

## Measured (`npm run eval:reader`, 54 golden sheets)

| | |
|---|---|
| Frames whose leader is followed to the pipe | 632 of 800 (79%), 478 of them ending on a weld dot |
| Against 77 points checked by eye (eval/cases/weld-points.json: 25-1001, 25-1012, 25-1017 SH2, 25-1022 SH2, 25-1027) | **right 77, wrong 0** |
| Weld dots on the pipe with the frames masked — what a sheet with no numbers is read with | 482 of the 632 traced weld points found (76%); 116 of 614 dots at no traced point. Looked at on two sheets (25-1074, 25-1017 SH1), those were welds too — a frame of a stack with no leader of its own, a joint of the next sheet (dashed frame), a frame printed "0" — so 19% is the most that can be wrong, not what is. On 25-1001, a sheet that draws no dots, all 17 of its dots are not welds (the border filter took it down from 63). |
| Markers, title block, BOM, cut lengths | unchanged (799/804 found, 0 invented; BOM and cut sizes 0 wrong) |

Each guard was turned off and the measurement showed what it prevents: the
pipe reached past a crossing of two thin lines (off: 25-1001 weld 2 ends on
a dimension line), and short thick shapes only beyond the frame's own label
(off: 25-1012 weld 5 ends on its "FFW").

A sheet takes about 50 s on the server instead of 34 s (the 300 dpi render
and the leaders, 5 s of it after the leaders' exits were found in a window
round each frame instead of over the whole page).

On the example sheet 25-1020 SH1: 18 of its 28 frames are followed to their
weld point, every one right by eye; the other ten — seven frames of stacks
with no leader of their own (4, 5, 6, 10, 14, 19, 23), the threaded joints 15
and 24, and weld 1 — are left without a point. The same sheet with its frames whited out gives 18 dots: 14 of the
18 traced weld points, and two more that are real welds (weld 10's dot, and
one at 27).

## In the app

The no-model route (app/piping/page.jsx readLocal) joins each frame read on
the sheet to its weld point, so the frame's leader is drawn as on the engine
route. On a sheet with no weld numbers printed, the dots become suggested
welds — rows of the weld list, each a dashed circle (location unknown) joined
to its dot — numbered only in an order along the pipe to start from
(lib/sheet/weld-dots.mjs); the page says they are suggestions, and Shop/Field,
type and size stay for a person, as everywhere.

## Not done

- Welds with no dot on a sheet with no numbers (threaded and socket joints,
  sheets that draw no dots) are not found.
- The numbering of suggested welds is an order to start from, not the
  designer's.
