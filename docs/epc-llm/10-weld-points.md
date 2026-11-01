# 10 — Where each weld is on the pipe, read with no model

Phase 2 of the no-model reader (tools/iso-read.py `weld_points`): the place
of each weld on the pipe — the end of each printed frame's leader on a sheet
with weld numbers, and the weld dots and socket ends on a sheet without them.

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
  snaps to a dot within 14 px. The pipe reached further along the same line
  wins over a crossing of two thin lines passed on the way. Short thick
  shapes (a fitting's body, a socket end) count only beyond the frame's own
  label — **on the bend too**: the first version let the second leg of a bent
  leader end on the bold FFW or THD printed beside the frame (below). A frame
  whose leader is not followed to the pipe has **no** weld point — also a
  frame in a stack drawn without a leader of its own: it is a weld of its
  own, with its own dot, not the stack's point.
- **A sheet with no numbers printed**: the dots on the pipe (a ring round
  each crosses the pipe's heavy line; none near the page's edge) and the
  **socket ends** are the candidate welds.
- **Socket ends** (`socket_ends`): a socket-weld joint is often drawn with no
  dot, at the fitting's socket end — a filled, blunt block on the pipe, one
  each side of a socket-weld valve's bow-tie. Measured on the golden sheets:
  the block's inscribed radius is 7 px or more (a dot's 6.3 at most); it is
  short and blunt (elongation under 1.95, its smallest enclosing triangle at
  least 1.58 times its area) where a flow arrowhead — filled too — is long and
  pointed (2.08 and more); and the pipe's heavy line runs on from one end only
  (the other is the valve's thin bow-tie), where an arrowhead sits inside a
  straight run. In the app its row's joint type is SW, as the symbol says.

## A correction to the first version

The first version (PR #37) said every frame followed on 25-1020 SH1 was right
by eye, and 77 of 77 on five sheets. That check was on the prototype's
picture, not the reader's own output, and the five sheets had few frames
printed with a label. Looked at again, the reader's own output put the
leaders of frames printed with FFW or THD on the label itself when the leader
bent: on 25-1020 SH1 welds 7 and 27, and on the golden sheets 25-1003 13 and
15, 25-1035 21, 25-1037 SH1 1 and 4, 25-1037 SH2 25, and five threaded joints
(their THD). Scored against the points now checked by eye, the first version
is right on 97 of 103 and wrong on 6; this one is right on 103. With the
label kept out of the bend turned off, 15 leaders end on a label again.

## Measured (`npm run eval:reader`, 54 golden sheets)

| | |
|---|---|
| Frames whose leader is followed to the pipe | 617 of 800 (77%), 484 of them ending on a weld dot |
| Against 103 points checked by eye on 20 sheets (eval/cases/weld-points.json: five whole sheets, and every frame printed with a label whose leader is followed) | **right 103, wrong 0** |
| Weld dots on the pipe, frames masked | 489 of the 617 traced weld points found (79%); 92 of 597 dots at no traced point — looked at on two sheets, those were welds too (stacked frames with no leader of their own, joints of the next sheet); on 25-1001, which draws no dots, they are not welds |
| Socket ends | 47 of the 82 traced socket welds with no dot found (57%); 15 of 62 ends at no traced point; **none** on the 6 flow arrowheads checked by eye (with the shape test off, all 6 are taken) |
| Dots and socket ends together — what a sheet with no numbers printed is read with | 537 of the 617 traced weld points (87%) |
| Markers, title block, BOM, cut lengths | unchanged (799/804 found, 0 invented; BOM and cut sizes 0 wrong) |

A sheet takes about 45-50 s on the server.

On the example sheet 25-1020 SH1: 18 of its 28 frames are followed to their
weld point, every one right by eye; the other ten are left without a point —
seven frames of stacks with no leader of their own (4, 5, 6, 10, 14, 19, 23),
the threaded joints 15 and 24, and weld 1. The same sheet with its frames
whited out gives 18 dots and 3 socket ends (at its three 3/4" socket-weld valves).

## In the app

The no-model route (app/piping/page.jsx readLocal) joins each frame read on
the sheet to its weld point, so the frame's leader is drawn as on the engine
route. On a sheet with no weld numbers printed, the dots become suggested
welds — rows of the weld list, each a dashed circle (location unknown) joined
to its dot — numbered only in an order along the pipe to start from
(lib/sheet/weld-dots.mjs); the page says they are suggestions, and Shop/Field,
type and size stay for a person, as everywhere.

## Not done

- Threaded joints. Of the 32 threaded joints of the golden registers none is
  found on a sheet with no numbers, and none of their frames' leaders is
  followed now (five were, onto their THD label — the first version's error).
  The threaded end is drawn thin (an open cap, a threaded coupling), with no
  filled body to tell it by; finding it needs points checked by eye first.
- Socket welds whose socket end is not a filled block (43% of those with no
  dot), and welds on sheets that draw neither dots nor blocks (25-1001).
- The numbering of suggested welds is an order to start from, not the
  designer's.
