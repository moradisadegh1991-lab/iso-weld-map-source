# SLD extraction evaluation

`npm run eval:sld` reports precision / recall / F1 **per category** over `eval/sld/cases.mjs`; `-- --check` fails when a category of the **vector** sheets is worse than `baseline.json` (tolerance 0.02); `-- --update` rewrites the baseline.

Categories (never combined into one number): `symbolDetection` (a predicted box matches a gold box, IoU ≥ 0.4), `symbolClassification` (matched **and** the right class), `textExtraction`, `tagExtraction`, `symbolToTagAssociation`, `ratingExtraction`.

## What these numbers are — and are not

Every case is **synthetic**: drawn by `dsl.mjs` with regular symbols and Helvetica text, ground truth recorded as it is drawn. The rules in `lib/sld/extract/classify.mjs` were written to the same conventions, so a near-perfect vector score proves only that the engine does what it was written to do and that a regression is caught. It is **not** an accuracy for real single-line diagrams, and no real-world figure may be quoted from it. The scanned cases (OCR + OpenCV) are reported but not gated: tesseract / OpenCV versions move them.

## The minimum real-data package for a real evaluation

None exists in this repository. A representative evaluation needs, at least:

1. **≥ 30 real SLD sheets** from ≥ 5 projects / CAD systems, both **native vector PDFs** and **scans** (at least 10 of each), including rotated pages and multi-sheet sets, in the project's real fonts (Persian and English), scales and clutter.
2. **Human-labelled gold per sheet** by two engineers with disagreements adjudicated: every symbol (box + class from `lib/sld/extract/vocab.mjs`, including UNKNOWN shapes), every text block (string, role: tag / voltage / rating / cable / off-page / other), every tag→symbol link, every rating→symbol link.
3. **A frozen split**: tune on one part, report only on a held-out part nobody tuned on.
4. **Per-class counts** (a class with fewer than ~20 instances gets no stand-alone figure) and a **confidence-vs-correctness table** — the engine's confidence is a heuristic rule score, not a probability, and is uncalibrated until this exists.
5. For Persian text: the `fas` tesseract language data on the server (only `eng` is installed here) and a native-Persian PDF sample.
