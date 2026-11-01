# 12 — The welds a sheet's BOM implies, beside the welds found

The owner's request (2026-11-01): once the BOM is read, the welds follow
from it — an elbow, say, is welded at both ends to a fitting or a pipe.

## The count (lib/register/bom-welds.mjs)

Each BOM item is counted by its **joined ends**, as its description says
they are made (the end-type words the platform already reads,
`endTypes`: BW / BE, SW / PE, NPT / THD / TOE):

| Item | Ends counted |
|---|---|
| elbow, coupling, union | 2 (BW or SW) |
| tee | 3 — a reducing tee's branch at the small size; a cross 4 |
| reducer | one at each size |
| cap | 1 |
| weld-neck flange (a two-size one: at the branch size) | 1 BW |
| socket-weld flange | 1 SW |
| slip-on flange | 1 SO |
| stub end | 1 BW (its lap-joint flange none) |
| half coupling, any -olet | 1 OLET (welded to its run) at the branch size, and its branch end |
| valve, strainer, trap… | 2 when its ends are BW or SW; none when flanged (RF, FF, RTJ, wafer, lug) |
| swage | its bevelled end(s); a plain end goes into a socket, counted there |
| pipe, nipple, reducer insert's plain end | none — their ends are the sockets and bevels they meet, counted there |
| gasket, bolts, blind, spectacle, instrument, support | none |

A threaded end (NPT, THD) is counted apart: it is a joint of the register
(kind THD), not a weld.

What the number is:

- every welded end is one weld, **except** two fittings welded straight to
  each other (a weld-neck flange on an elbow) — those two ends are one weld.
  So the sheet's fittings make at most `ends` welds, and at least half;
- a weld of pipe to pipe (a straight run of two lengths) is in no BOM row,
  nor is a joint to the next sheet's pipe.

What is not counted, and said so — never guessed:

- a row whose description does not say how its ends are made (an elbow with
  no BW / SW / NPT);
- a quantity not read, or not a whole number of pieces;
- **a PT number missing** from 1 to the last: a row the OCR did not read.

## In the app

Beside the weld list (components/BomWelds.jsx), with the sheet's BOM:

- the BOM's welded ends by size and kind, the rows they come from, and the
  welds of the list at the same size and kind — a row where they differ is
  marked;
- the count's range (at most / at least), and a warning when the list has
  fewer welds than the least the BOM implies;
- what was not counted, by PT number.

The BOM table is now **edited here**: a row the OCR did not read is added
(«+ ردیف BOM», numbered with the first PT missing), a quantity or size
corrected. It is what is saved as the sheet's BOM (PR #39's `iso_bom_row`)
and what the welds are counted from. On the example sheet (the CWR style,
page 9) the BOM read missed PT 7 and 11: with the two rows typed from the
drawing the count is complete — 10 welded ends, so 5 to 10 welds — where the
sheet prints no weld numbers and no weld dot was found.

## Measured (`npm run eval:bom-welds`, golden sheets)

The golden MTO carries no quantities, so the BOM is the one the no-model
reader read off each sheet (its cache from `eval:reader`), against the
contractor's register.

| | |
|---|---|
| Sheets whose BOM was read whole (every PT, every quantity, every row's ends said) | 15 of 48 — on the others a PT row or a quantity was not read (most often one row), and the count says so |
| On those 15: the BOM's welded ends against the register's welds | **equal on 8**, within 3 on 14; one off by 6 (25-1020 SH1: 6 sockets of 3/4" in its BOM, 13 socket welds in the register) |
| By kind, ends / register welds | BW 86 / 77 (fittings welded to each other) · SW 149 / 158 · OLET 10 / 9 · threaded joints 16 / 11 |

On 25-1020 SH1 the theory is seen size by size: 6" BW 9 ends and 9 welds;
4" BW 2 ends and 1 weld — the 4" weld-neck flange welded straight onto the
reducer. Each rule was turned off and its test went red (a PT number missing
not counted as incomplete, an elbow whose ends are not said taken as BW, a
quantity not read taken, nipples counted).

## Not done

- Which weld on the drawing a BOM item's end is: the count says how many
  and at what size, not where.
- Slip-on flanges: this contractor's register lists their weld as BW
  (25-1007); counted apart as SO.
