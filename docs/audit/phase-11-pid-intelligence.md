# Phase 11 — P&ID Intelligence & Engineering Register: audit (Step 0)

Baseline: master `cfcca16` (Phases 1–10). Branch `feat/pid-engineering-intelligence`. Nothing in this document is built yet; it records what is there.

## 1. A P&ID implementation already exists (not to be duplicated)

| Piece | File | What it does |
|---|---|---|
| OCR page reader | `tools/pid-ocr.py` (RapidOCR, 6 overlapping tiles per page) | text strings with boxes `{t, b:[x0,y0,x1,y1], c}` → `ocr/pNNN.json` |
| Instrument bubbles from geometry | `tools/pid-bubbles.py` | circles fitted to arcs, inside re-read: letters above / loop number below |
| Deterministic parser | `lib/pid/ocr-parse.mjs` | `parseSheet`: title block + revision table, equipment tags (`30-E-1129`), line numbers (K110 legend format), off-page refs (`21-10-15/1`), data boxes, instruments (`instrumentsFromBubbles` → `parseTag`). It READS; unreadable stays null; never infers size/service/class |
| K110 legend rules | `lib/pid/legend-k110.mjs` | section, fluid (62), insulation (15), equipment-letter tables, `equipmentType()` |
| Register builder | `tools/pid-registers.mjs` (`npm run pid:registers`) | all sheets → drawings / equipment / lines / instruments / problems, each row naming the sheets that print it |
| Loader | `lib/pid/load.mjs`, `tools/load-pid.mjs` (`npm run pid:load`) | files a read set into a project through the spine: unit, subsystems (process sections), MDR drawing register + printed revisions (`upsertMdr`/`issueRevision`), `importEquipmentList`, `lineForRegister`, `importInstrumentIndex` |
| Data | `data/k110/registers.json` (242 sheets: 370 equipment, 3103 lines, 5698 instruments, 760 problems), `K110-PID-registers.xlsx` | OUTPUT of the above; the 242-page source PDF (`P&ID K1.zip`, 24 MB) is in the private archive repo, not in this repo |
| Tests / docs | `db/test/pid.mjs`; `docs/epc-llm/07-pid-k110.md` | parser + loader tests; accuracy only on 3 hand-read sheets ("not statistics for the set") |
| ISA | `lib/instrumentation/isa.mjs` | `parseTag`, VARIABLES/FUNCTIONS/CATEGORIES, `parseInstrumentIndex` |

Registers it feeds (reused, not duplicated): `tag` (asset spine, UNIQUE project+tag_no), `instrument` (`016`, UNIQUE project+tag_no), equipment import, `line`, `subsystem`, `mdr_document`/`mdr_revision` (doc control), `asset_master`.

## 2. What does not exist

* **No bounding boxes / symbol model**: `parseSheet` returns tags, lines and refs with the sheet number but drops the OCR box. Nothing keeps *where* on the page, nor a stable uid.
* **No valves / inline components, no symbol recognition at all** (OCR + circle geometry only).
* **No connectivity graph**, no equipment↔line↔instrument relationship, no off-page *resolution* (refs are collected as strings).
* **No review workflow for P&ID data**: the loader writes straight to the registers (a "read" is loaded, not drafted/approved); no per-record status, audit of corrections or approval.
* **No P&ID workspace / viewer** (`/piping` is the isometric workspace; no page for P&ID), no validation findings for P&ID, no revision comparison of P&ID content.
* **No category-separated evaluation**: only the 3-sheet note above; there is no P&ID golden set.
* **No LLM/vision pass for P&ID**: `/api/extract` and `lib/llm/` are isometric-specific (prompt, schema, sanitizer). No model access exists in this environment to build or measure one.

## 3. Reusable components

* Intake: `document` (project, doc_no, revision, sheet_no, sha256, storage_uri, parent_document_id / supersession — Phases 8) + `/api/documents`, `lib/storage/*`, `mdr_*` for the register/issue purposes (`purposeOf`).
* **Draft + approval machinery**: `extraction_run` (bound to a `document` = one drawing revision; `payload jsonb`, `status extracted|approved|superseded|failed`, `approved_by/at/sha256` with the `approval_is_complete` CHECK and the run triggers; `lib/platform/workflow.mjs` `assertEditable` / `assertTransition`; `approveRun` is payload-generic — its digest is `{payload, welds}` and a P&ID run has no weld rows), `extraction_edit` (path/field/before/after/reason/who — the audit of corrections), `payloadHash` + `baseHash` stale-edit contract, `pass_name`, LLM token columns.
* Validation Center: `lib/engineering/validation.mjs` (`CATALOG`, `make()`, `summarize`, finding shape), `ValidationPanel`, `lib/client/validation-center.mjs`.
* Revision lifecycle (Phase 8): `document.parent_document_id`, `compareRevisions` pattern; `revision_carry_map.cls` is CHECK-limited to `weld|spool|support|equipment`.
* UI: `WorkspaceFrame` / `WorkspaceTabs` / `Explorer`, `TableKit`, `FormDialog`, `ConfirmDialog`, theme tokens, pdf.js (`public/pdf.worker.min.mjs`) page rendering used by the isometric sheet.
* Auth: `authenticate` + `assertCan(ACTIONS.*)` + `withProject` (RLS) + area classification `lib/platform/areas.mjs` (route coverage test `db/test/area-coverage.mjs`), tile map (`lib/platform/tile-apis.mjs`).

## 4. Constraints found

* `extraction_run` rows are listed by the piping **review queue** (`reviewQueue`, status `extracted`) and by the per-document "latest run" helpers; a P&ID draft stored there must be kept out of the isometric queue (filter on `pass_name`).
* `revision_carry_map` cannot hold P&ID classes without a migration (CHECK, as for cut pieces in Phase 9).
* `parseSheet` is covered by `db/test/pid.mjs` and the loader by real DB tests: it is **not modified**; a new adapter works from the same raw OCR items.
* The K110 source PDF and raw OCR dumps are not in this checkout and no OCR engine is installed here (RapidOCR, a model runtime) and disk space is ~1 GB: the OCR step is not re-run in this phase.

## 5. Proposed architecture (what Phase 11 builds)

1. **Draft data contract** (`lib/pid/draft.mjs`, JSON in `extraction_run.payload`, `kind: "pid"`): page(s) with original dimensions; items `{uid, cls, symbol, tag, bbox (normalized + page px), center, page, ocrText, confidence, source: {kind: "ocr"|"vision"|"user", ref}, evidence[], review{status, original, corrected, by, at}}`; edges `{uid, type, from, to, evidence[], status}`; `mappings` (explicit, target-side). Deterministic adapters: OCR items → draft (reusing `equipmentTags`, `lineNumbers`, `sheetRefs`, `parseTag`, with boxes kept); a strict **proposal sanitizer** for vision/LLM output (the model can only *propose*; nothing it returns becomes approved).
2. **Connectivity graph** (`lib/pid/graph.mjs`): only explicit evidence makes an edge; proximity never does; off-page connectors resolve only to a unique compatible sheet reference, else `unresolved`/`ambiguous`.
3. **Review workflow** (`lib/pid/review.mjs`): Extracted → Needs Review → Corrected → Approved (+ Rejected, Unresolved, Ambiguous, Superseded); original value kept beside the correction; approval explicit, by/at recorded; approved records only change through the run policy (`RUN_LOCKED`) / a new revision.
4. **Persistence** (`lib/db/repos/pid.mjs`): drafts as `extraction_run` (`pass_name = 'pid'`) bound to the drawing revision's `document`; corrections audited in `extraction_edit`; stale edits refused by `baseHash`; ingest idempotent by payload hash; run approval via the existing `approveRun`; **asset link proposals** (`tag`/`instrument`/`line` lookups — proposed, never created automatically, duplicates/ambiguity need a human).
5. **Registers as views** (`lib/pid/registers.mjs`): Equipment, Instrument Index, Line List, Valve List, Connectivity, Off-page — derived from the draft; each record carries uid, project, document, revision, page, tag, evidence, status, findings.
6. **Validation**: `P_*` codes added to the existing `CATALOG` (`validatePid` in `validation.mjs`, same finding shape; distinguishes errors from missing information).
7. **Revision comparison** (`lib/pid/compare.mjs`) by explicit mappings (candidates only for unique tags; never auto-matched), no UID copied across revisions.
8. **UI**: `/pid` page on the existing workspace frame: drawing viewer (page navigation, zoom/pan, bbox overlays, confidence/status) + engineering tabs; two-way selection sync.
9. **Evaluation** (`eval/pid/`): per-category metrics, a missing value never counts as correct.

## 6. Migration requirements

None expected: draft/approval/audit/revision binding all fit `extraction_run` + `extraction_edit` + `document`. A migration would only be needed to give P&ID classes a row in `revision_carry_map` (deferred: mappings are stored in the target draft). Nothing is run on production; migration 106's production status stays a separate operational task.

## 7. Honest limits of this environment (stated before building)

No vision/LLM access and no OCR runtime here, and the source PDF/OCR dumps are not in this checkout. So: the vision pass is specified as a *proposal contract* with a strict sanitizer and tested with fixtures, **not** wired to a model; K110 recognition accuracy is **not measured** in this phase (the evaluation harness and its synthetic difficult-case golden are built; real per-category K110 numbers need the OCR run and a hand-labelled set).

---

# Implementation record (after Step 0)

## 8. Architecture as built
Pure layer `lib/pid/*` (no Node-only imports in what the browser uses: `vocab.mjs`, `graph.mjs`, `review.mjs`) · persistence `lib/db/repos/pid.mjs`
(an `extraction_run` with `pass_name='pid'`, one per document revision) · `app/api/pid` + `app/api/pid/review` · UI `app/pid/page.jsx`,
`components/PidViewer.jsx`, `components/PidPanel.jsx`, `lib/client/pid-center.mjs` · rules in `lib/engineering/validation.mjs` (`validatePid`).
Nothing in the isometric pipeline (`parseSheet`, the loader, weld/spool/cut code) was changed; the weld review queue now excludes `pass_name='pid'`.

## 9. P&ID data contract (`lib/pid/draft.mjs`)
`{kind:"pid", schema:1, meta, page:{number,width,height}, items, edges, mappings, source:{kind,reader,hash,generatedAt,problems}}`
* item `{uid, cls, symbol, tag, printed, bbox(normalized 0..1)|null, center, page, ocrText, confidence, attrs, source, evidence[], review}`
* edge `{uid, type, from, to|null, ref, evidence[], status, candidates?, review}`
* `review.status`: extracted → needs_review → corrected → approved; also rejected, unresolved, ambiguous, superseded. `review.original` keeps the
  extracted value once; `by`/`at`/`reason` are recorded. A reader (OCR or model) can only create `extracted` records — any status it sends is ignored.
* symbols outside the per-class list are `UNKNOWN`; an equipment's symbol is never taken from its tag letters (a legend hint stays in `attrs.legendType`);
  an edge without evidence or with an unknown end is rejected and listed.

## 10. Symbol recognition — what it does and does not do
There is **no vision model and no OCR runtime in this environment**, so no symbol detector was built or measured. The draft accepts (a) the existing
OCR strings/bubbles (`draftFromOcr`, same clash/shorter-reading rules as the register reader) and (b) a model's *proposal* (`sanitizeProposal`).
Equipment/instrument/line/valve classes come from the reader; ISA letters give only what ISA says (`instrumentFacts`); nothing is inferred from position.

## 11. Connectivity graph
Edges exist only when stated with evidence (no proximity edges). `buildGraph` yields valid edges, an invalid list, adjacency, off-page entries.
Off-page: `resolved` only when exactly one compatible connector on the target drawing points back (a `lineRef` disambiguates); otherwise
`unconfirmed` / `unresolved` / `ambiguous` with candidates. Asset links are *proposals* (unique / multiple / none by normalized tag); nothing is created.

## 12. Revision comparison
`comparePid` reports mapped / candidate / ambiguous / added / removed / renumbered / changed / connectivity and off-page differences. Candidates are
proposals only. `confirmMapping` is explicit, one-to-one, same-class, stored on the **target** draft (`revision_carry_map.cls` cannot hold P&ID classes,
so no migration), refused on a signed-off target; UIDs are never copied and approved data is never overwritten.

## 13. Evaluation (`npm run eval:pid`, baseline `eval/pid/baseline.json`)
**Synthetic** golden cases (8; incl. low-resolution, dense/overlapping text, duplicates, similar instrument tags, multipage, off-page + revision cloud,
valves/crossings). A missing value is never counted correct. This is a regression harness for the deterministic layer, **not a K110 accuracy figure**.

| category | precision | recall |
|---|---|---|
| equipment tag | 91.7% | 84.6% |
| instrument tag | 75.0% | 100% |
| line number | 100% | 83.3% |
| valve symbol | 100% | 100% |
| connectivity (stated edges) | 100% | 75.0% |
| duplicate detection | 100% | 100% |
| off-page resolution accuracy | 100% (0 wrongly resolved) | |
| false-positive rate | 8.3% | |

The weak case is `low-resolution-scan` (equipment 33%/50%): readings with clashing characters are dropped rather than guessed.

## 14. Verification
* `db/test/pid-intelligence.mjs` — 27 tests (pure + server: ingest idempotency, sanitization, authorization, stale edit 409, sign-off preconditions and lock,
  revision isolation, review-queue exclusion) — added to the `db:test` chain.
* Browser drive `tools/drive-pid.mjs` on a **synthetic** sample sheet (labelled as such on the page): 17 checks passed (upload as P&ID, boxes drawn, row↔drawing
  selection both ways, go-to zoom, correction keeps the original, sign-off refused while undecided (UI and server), rejection with reason, sign-off with who/when,
  locked afterwards, phone width without horizontal scroll). Screenshots: `docs/audit/phase-11-shots/` (dark, light, phone light/dark).
* Isometric regression: `tools/drive-equipment-spool.mjs` (Phase 10 drive) — all checks true, no page errors.

## 15. Limitations / risks
* No real K110 P&ID, OCR runtime or model access here: real-sheet accuracy is **unmeasured**. The synthetic numbers must not be quoted as accuracy.
* The page renders the stored PDF page client-side (pdf.js) at ≈110 dpi; very large sheets are down-scaled for display only (the PDF stays the source).
* Instrument bubbles are read only from the OCR reader's `bubbles` input; a plain text "PIC 1101" is not turned into an instrument (never guessed).
* Revision-comparison mapping UI is minimal (candidate list + confirm); batch mapping is not built.
* Migration: none. No production migration was run.
