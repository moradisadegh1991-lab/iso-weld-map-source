# Phase 12 — SLD Intelligence & Electrical Engineering: architecture audit (Step 0)

Audit and design only. Nothing in this document is implemented; no production code, schema or test was changed.
Audited against `master` @ `fe7bd98ae31e1cc7cb33367d3bcbe871ce85f565` (Phase 11, PR #85). PR #86 (Phase 11.1, off-page integrity) is **not** merged and is
not depended on; where Phase 12 relies on a P&ID rule that #86 changes, this document says so (§7.4).

Conventions: **[verified]** = read in the repository at that SHA; **[proposal]** = design, not present; **[unverified]** = not checked, stated so it is not mistaken for a finding.

---

## 1. Current architecture inventory (exact paths)

### 1.1 Electrical today — a cable-schedule module, not a diagram module
| Concern | Path | What it is [verified] |
|---|---|---|
| Engine | `lib/electrical/cable.mjs` (221 lines) | `parseCableSize`, `parseRating`, `parseCableSchedule` (CSV → rows, unknowns left empty and flagged), `matchTag` (exact whole-token tag match; two tags in one field → `null`), `irRequirement`, `parseReading`, `judgeIr` (IEC 60364-6 Table 6.1 for LV; MV only from the project's own criterion; refuses without circuit voltage). |
| Repo | `lib/db/repos/electrical.mjs` (299 lines) | `importCableSchedule` (upsert by `(project_id, cable_no)`, corrections survive re-import), `correctCable`, `recordIrTest`, `cableStatus`, `recordCableActivity`, `cableBoard`, `deriveTagElectrical` (the tag's `electrical` step answered by the cables feeding it). |
| API | `app/api/electrical/route.js` (60 lines) | GET board/status; POST `import`/`correct` need `EDIT_EXTRACTION`, `activity`/`ir` need `ASSIGN_WELD`. Area `electrical` in `lib/platform/areas.mjs`. |
| UI | `app/electrical/page.jsx` (334 lines) | Cable board, cable detail (chain, IR test form), correction form, schedule paste/import. No drawing viewer. |
| Schema | `db/migrations/015_electrical.sql` | `cable`, `cable_activity`, `ir_test`, project spec columns (`lv_system_voltage_v`, `mv_ir_test_voltage_v`, `mv_ir_min_mohm`), RLS, `reporting.fact_cable`, `reporting.fact_progress` electrical branch. |
| Tests | `db/test/electrical.mjs` (21 tests) | cable parse/IR/judgement/chain; plus cable fixtures in `db/test/asset.mjs`, `field.mjs`, `claims.mjs`, `inspection.mjs`, `intake.mjs`, `assumptions.mjs`. |
| Platform registry | `lib/platform/modules.mjs` (electrical entry) | `source: "لیست کابل · SLD"`, `status: "planned"`, `execution: "live"` — the SLD is *named* as a source but nothing reads it. |

### 1.2 The spine and registers Phase 12 must reuse
| Concern | Path | Notes [verified] |
|---|---|---|
| Tag (project identity) | `db/migrations/007_spine.sql`, `lib/db/repos/spine.mjs` (`upsertTag`) | `tag(id, project_id, subsystem_id, tag_no, discipline, kind, description)`, `UNIQUE(project_id, tag_no)`. `discipline` enum already contains `electrical`. `tag.carries_tag_id` exists (later migration; read by `lib/db/repos/asset.mjs`). |
| Subsystem | `007_spine.sql`, `spine.mjs` | handover unit; `cable`, `document`, `tag` carry `subsystem_id`. |
| Asset master | `db/migrations/027_cmms_handover.sql`, `046_design_conditions_dcs_tags.sql`; `lib/db/repos/asset.mjs`, `lib/db/repos/handover.mjs` | `asset_master(tag_id PK, iso_class, criticality, manufacturer, model, serial_no, year_built, design_pressure_barg, design_temp_*_c, design_datasheet_rev_id)` + append-only `asset_master_revision` (snapshots). **No electrical rating columns exist** (no voltage, kVA, current, short-circuit, impedance). `assetThread` joins every discipline on the tag id and lists what is *not held*. |
| Equipment import | `lib/db/repos/equipment.mjs`, `lib/equipment/parse.mjs` | creates tags with `discipline: 'equipment'`; classification by description (`kind`), ambiguous → left for an engineer. No code creates `electrical`-discipline tags from a list or a drawing. |
| Documents / revisions | `db/migrations/001_core.sql` (`document`), `035_current_revision.sql`, `106_revision_lineage.sql`; `lib/db/repos/documents.mjs`, `revision-lifecycle.mjs`, `revisions.mjs` | `document(doc_no, doc_type text DEFAULT 'isometric', revision, sheet_no, file_sha256, storage_uri, superseded_by, parent_document_id…)`, `UNIQUE(project_id, doc_no, revision, sheet_no)`. **`doc_type` is free text**; `app/api/documents/route.js` whitelists only `pid`/`isometric` (everything else becomes `isometric`). |
| MDR / issue lifecycle | `db/migrations/026_document_control.sql`, `lib/documents/control.mjs`, `lib/db/repos/doc-control.mjs` | `mdr` (register, has `discipline`, `doc_type`), `mdr_revision` (purpose `IFR/IFA/IFC/AB/VOID`), transmittals and return codes 1–4. |
| Document intake | `db/migrations/063_doc_intake.sql`, `lib/intake/*`, `lib/db/repos/intake.mjs` | reads received documents (pdf-text / xlsx) into proposals; item `kind` is CHECK-limited to `drawing, equipment, line, instrument, subsystem, system` — **no `cable` or `sld` kind**. Only approved revisions (code 1/2) are read. |
| Extraction run | `001_core.sql` (`extraction_run`, `run_status` = extracted/approved/superseded/failed), `005_review.sql` (`extraction_edit`), `lib/db/repos/runs.mjs` | `pass_name text` (free), `payload jsonb`, `approved_by/at/sha256`, `document_id NOT NULL`. |
| Stable identity of drawing entities | `lib/sheet/mark-identity.mjs`, `105_stable_mark_identity.sql` | uid helpers (`isUid`, `newUid`); the DB identity table `sheet_mark_identity` covers isometric marks only. |
| Validation engine | `lib/engineering/validation.mjs`, `lib/db/repos/validation.mjs`, `components/ValidationPanel.jsx` | `CATALOG`, `make()`, `summarize`; categories … `data-integrity`, `pid`; `validatePid` (Phase 11). No electrical rule. |
| Instrumentation | `db/migrations/016_instrumentation.sql`, `lib/db/repos/instrumentation.mjs`, `lib/instrumentation/isa.mjs` | instrument index; an instrument hangs off the equipment tag it serves (`eq_tag_id`). Closest existing analogue of "an electrical load hangs off a feeder". |

### 1.3 The P&ID architecture (the reference for Phase 12)
`lib/pid/{vocab,draft,graph,review,registers,compare}.mjs`, `lib/db/repos/pid.mjs`, `app/api/pid/route.js`, `app/api/pid/review/route.js`, `app/pid/page.jsx`,
`components/{PidViewer,PidPanel}.jsx`, `lib/client/pid-center.mjs`, `db/test/pid-intelligence.mjs` (27 tests), `eval/pid/*`, `docs/audit/phase-11-pid-intelligence.md`.

### 1.4 Search for existing SLD / switchgear / feeder / busbar / transformer / breaker / relay / load code [verified]
A repository-wide, case-insensitive search (`app lib db components tools docs`, excluding the LLM-relay code whose "relay" is a network relay) for
`single line`, `SLD`, `busbar`, `switchgear`, `transformer`, `feeder`, `circuit breaker`, `MCC`, `isolator`, `protection relay`, `earthing` found:

* **No implementation** of any SLD element: no table, repo, route, page, parser, test or eval case. Not in `db/migrations/*.sql`, not in `lib/**`.
* Documentation/registry mentions only: `lib/platform/modules.mjs` (`source: "لیست کابل · SLD"`), `lib/reference/epc.mjs:75` (`نقشهٔ تک‌خطی (SLD) و لیست بار` as a document-engineering item "phase 3 reading"),
  `docs/digital-epc/doc-intake.md:57` (SLD feeds cables, planned), `docs/digital-epc/00-master-plan-alignment.md` item 9, `EPC_AI_MASTER_CONTEXT.md` (`[OPEN] P&ID and SLD parser`), `02-project-review.md`.
* **Not SLD code but easily mistaken for it:** `MCC` appears in data as the cable *From* text (`MCC-12`, `MCC-70` …, a Motor Control Centre) in fixtures/seed (`db/test/electrical.mjs`, `tools/seed-demo.mjs`) **and** as *Mechanical Completion Certificate* in `lib/reference/epc.mjs`/completions. SLD code must never key on the string "MCC".
* `lib/scenario/dm-pump.mjs`, `lib/scenario/guide.mjs`, `docs/digital-epc/03-scenario-dm-pump.md` mention a motor fed from an MCC only as scenario narrative.
* `lib/i18n/labels.mjs` has the electrical-termination chain step label (earthing/tracing) — a chain step on a tag, not a diagram element.

Conclusion: the electrical module holds a **cable register and cable activities**; every other SLD concept (sources, transformers, switchgear, buses, breakers, protection, feeders as circuits, loads as circuit members, earthing) is **absent** in data, API, UI and tests.

---

## 2. Existing database entities and relationships (electrical-relevant) [verified]

```
project ─┬─ tag (discipline enum incl. 'electrical'; kind; carries_tag_id) ── asset_master (tag_id PK; nameplate; design cond.) ── asset_master_revision (append-only)
         │        ▲                  ▲
         │        │ to_tag_id        │ eq_tag_id
         ├─ cable (cable_no UNIQUE per project; from_ref TEXT; to_ref TEXT; to_tag_id → tag; subsystem_id; spec/cores/size/rating/u_kv/voltage_class/system_voltage_v/length_m)
         │     ├─ cable_activity (code, status, done_at…)     ├─ ir_test (readings jsonb, test_voltage_v)
         ├─ instrument … eq_tag_id → tag
         ├─ subsystem ── tag/document/cable.subsystem_id
         ├─ document (doc_no, doc_type text, revision, sheet_no, parent_document_id, superseded_by) ── mdr / mdr_revision (issue purpose)
         └─ extraction_run (document_id NOT NULL, pass_name text, payload jsonb, status, approved_*) ── extraction_edit (audit of edits)
```
Facts that matter for the SLD:
1. **A cable resolves only its *To* end to a tag** (`to_tag_id`), by `matchTag` (exact token). Its **From end is free text** (`from_ref`) — a switchgear/MCC/DB feeding the cable is *not* a record. This is the single most important gap for SLD↔cable consistency.
2. Cables are keyed by `cable_no` (project-unique) — the stable identity every SLD cable reference must point at (never a second registry).
3. Tags carry no electrical rating; asset master has no electrical nameplate columns. Electrical ratings printed on an SLD therefore have **no authoritative home today**.
4. `extraction_run.document_id` is mandatory: an SLD sheet must exist as a `document` row first (document control owns identity, revision, file hash).
5. `revision_carry_map.cls` (106) is CHECK-limited to `weld, spool, support, equipment` — SLD classes cannot be stored there (same finding as P&ID; Phase 11 stored mappings on the target draft).
6. Several repos read `extraction_run` (`overview`, `workfront`, `field`, `log`, `piping-*`, `line-list`, `joint`, `coating`, `assumptions`, `contracts/metrics`…) and the weld **review queue** excludes P&ID by a **deny-list** (`COALESCE(r.pass_name,'') <> 'pid'`, `lib/db/repos/review.mjs:32`). A new `pass_name` is *not* excluded automatically (§6.2, risk R1). [The per-consumer audit of every one of those readers for a non-isometric run is **unverified** and is a Phase-12 entry task.]

---

## 3. Existing vs missing functionality

| Capability | Status |
|---|---|
| Cable register, import, correction, IR judgement, cable activities, QR/offline record | **Exists**, tested (`db/test/electrical.mjs`). |
| Cable ↔ tag (To end) | Exists (`to_tag_id`). |
| Cable From end as a record (switchgear/MCC/DB/panel) | **Missing** (text only). |
| Electrical equipment as tags (transformer, switchgear, MCC, DB, motor, breaker) | Partial: the tag spine supports it (`discipline='electrical'`); nothing creates them; asset master lacks electrical ratings. |
| SLD document filing | Possible with existing document control (`doc_type` free text) but the API whitelist rejects `sld` (becomes `isometric`). **Missing** (one-line whitelist). |
| SLD reading (vector/OCR/vision), draft, review, approval | **Missing.** |
| Electrical connectivity graph (source→bus→breaker→feeder→load) | **Missing.** |
| Electrical validation (rating, voltage transition, feeder destination, protection, cable consistency) | **Missing** (only IR judgement exists). |
| SLD workspace UI | **Missing.** |
| Real SLD samples / labeled evaluation data | **Missing** (§10.1). |
| Master-plan SLD item | Open (`00-master-plan-alignment.md` item 9) — see §13/§14 correction. |

---

## 4. Reuse and integration map

| Need | Reuse (no duplicate) | Gap handled by |
|---|---|---|
| Sheet identity/revision/file | `document` + `mdr`/`mdr_revision` + `revision-lifecycle` (`parent_document_id`, `createRevision`) | whitelist `doc_type='sld'` (code, no migration) |
| Equipment identity | `tag` (`discipline='electrical'` or `'equipment'`) | **proposal links only**; creation is a human action through `upsertTag`, never automatic |
| Equipment specification | `asset_master` | electrical ratings: see §11 decision (draft-held first; authoritative home is a decision for the owner) |
| Cable identity | `cable.cable_no` / `cable.id` | SLD stores `cableNo` + resolved `cableId` reference only |
| Draft storage, approval, edit audit, stale-edit guard | `extraction_run` (+ `extraction_edit`, `approveRun`, `assertEditable`, `payloadHash`/`baseHash`) | new `pass_name='sld'`, **own repo** (§6.1) |
| Validation | `lib/engineering/validation.mjs` (`CATALOG`, `make`, `summarize`) + `ValidationPanel` | new category `sld` + `S_*` rules |
| Revision comparison | explicit mapping stored on the **target** draft (Phase 11 `confirmMapping` design) | SLD-specific classes |
| UI frame | `components/workspace/WorkspaceFrame`, viewer/panel pattern of `PidViewer`/`PidPanel`, `FormDialog`, `TableKit`, `ValidationPanel` | SLD viewer/panel |
| Navigation to records | `/asset?tag=`, `/electrical` (cable), `/documents` | deep links by id |
| AuthZ/areas | `lib/platform/areas.mjs` (`/api/sld` → `electrical`), `assertCan` | add routes + `db/test/area-coverage.mjs` |

---

## 5. Proposed SLD data contract [proposal]

An SLD draft is the JSON `payload` of one `extraction_run` (`pass_name='sld'`) bound to the `document` of one sheet revision. It is a **proposal layer**: it never writes `tag`, `asset_master` or `cable`.

```
{ kind:"sld", schema:1,
  meta:{ drawingNo, revision, sheet, title, system, nominalVoltages:[{ref,value,unit}], notes },
  page:{ number, width, height },                       // original size kept; boxes normalized 0..1
  items:[ Item ], edges:[ Edge ], mappings:[], source:{ kind, reader, hash, generatedAt, problems[] } }
```
**Item** (`uid` = stable UUID, born with the draft, never reused across revisions)
```
{ uid, cls, symbol, tag, printed, bbox|null, center|null, page,
  ocrText, confidence,
  attrs:{ <attribute>: Fact },                         // electrical attributes, each a Fact (below)
  refs:{ tagId?, cableId?, cableNo?, documentRef? },   // explicit references to EXISTING records, set only by a person or a unique deterministic match
  source:{ kind:"vector"|"ocr"|"vision"|"person", ref, revision },
  evidence:[ { kind, text, bbox, confidence } ],
  review:{ status, original?, corrected?, by?, at?, reason? } }
```
**Fact** — the printed / extracted / calculated / unknown distinction required by the brief:
```
{ value, unit, basis: "printed"|"extracted"|"calculated"|"unknown", evidence:[…], derivedFrom?:[uid|attr], note? }
```
* `printed`: text read on the sheet, kept verbatim in `evidence[].text`; `value` is its normalized form only if the normalization is lossless.
* `extracted`: a reader's reading of a symbol/geometry (e.g. "this symbol is a breaker") — never authoritative.
* `calculated`: computed by the deterministic engine from other facts (e.g. a transformer ratio from two printed voltages); `derivedFrom` lists the inputs; a calculated fact is **not** stored over a printed one and never fills a missing printed rating.
* `unknown`: the explicit absence (`value: null`). An absent rating is `unknown`, never a default.

**Classes** (closed vocabulary, `lib/sld/vocab.mjs` [proposal]; unknown symbol → `UNKNOWN`, never "closest match"):
`source` (grid/utility incomer, generator), `transformer`, `switchboard` (MV/LV switchgear, MCC, PCC, DB), `busbar` (a bus *section*), `coupler` (bus coupler/tie), `breaker`, `isolator`, `contactor`, `fuse`, `protection` (relay/CT/VT as device), `feeder` (an outgoing circuit as a labelled way), `load` (motor, heater, lighting, UPS, other), `cable` (a reference), `earth`, `connector` (off-page), `annotation`.

**Per-class attributes (each a Fact; all optional; none defaulted)** — covering the 12 scope items:
| # | Scope element | cls / attributes |
|---|---|---|
| 1 | Incoming sources, grid | `source`: `voltage`, `phases`, `frequency`, `faultLevel`, `incomerRef` |
| 2 | Transformers | `transformer`: `ratedPower`, `hvVoltage`, `lvVoltage`, `vectorGroup`, `impedancePct`, `coolingClass`, `tapRange` |
| 3 | MV/LV switchgear/boards | `switchboard`: `voltage`, `ratedCurrent`, `faultRating`, `form`, `boardType` |
| 4 | Busbars/couplers/sections | `busbar`: `voltage`, `ratedCurrent`, `section`, `normallyOpen` (coupler) |
| 5 | Breakers, isolators, protection devices | `breaker`/`isolator`/`contactor`/`fuse`: `ratedCurrent`, `breakingCapacity`, `poles`, `state` (as drawn: open/closed/unknown) |
| 6 | Feeders/outgoings | `feeder`: `way` (printed way number), `rating`, `loadRef`; edges give source and destination |
| 7 | Motors, MCCs, DBs, loads | `load`: `ratedPower`, `ratedCurrent`, `voltage`, `loadKind` (as printed) |
| 8 | Protection relays & settings refs | `protection`: `relayType`, `functions[]` (ANSI numbers *as printed*), `settingsRef` (a reference to a settings document — **never a setting value inferred**) |
| 9 | Cable refs | `cable` item: `cableNo`, `printedSpec`; `refs.cableId` once matched; spec facts compared to the register, never overwriting it |
| 10 | Earthing | `earth`: `earthKind` (neutral earthing / protective), `resistorRef`; edges of type `earth` |
| 11 | Ratings/voltage levels/specs | the Fact attributes above; `meta.nominalVoltages` for the voltage levels the sheet states |
| 12 | Off-page | `connector`: `targetSheet`, `connectorLabel`, `lineRef`→ here `circuitRef`, `direction` |

**Edge** (a connection exists only when *stated or geometrically proven with evidence*; proximity never makes an edge):
```
{ uid, type:"power"|"control"|"signal"|"earth"|"offpage"|"measures" , from:uid, to:uid|null, via?:uid (breaker/isolator in the path),
  ref, evidence:[…], status:"explicit"|"unresolved"|"ambiguous", candidates?:[uid], review:{…} }
```
`measures` (CT/VT → protection) and `control`/`signal` are kept distinct from `power` so a protection relationship is never read as a power path.

**Review statuses** are exactly Phase 11's: extracted → needs_review → corrected → approved (+ rejected, unresolved, ambiguous, superseded); a reader can only create `extracted`; original and corrected values are kept; approver and time recorded; no automatic approval.

---

## 6. Extraction and validation architecture [proposal]

### 6.1 Can the P&ID `extraction_run` architecture be reused without coupling the disciplines?
**Yes for storage, approval and audit; no for the code.** Reuse the *table and its invariants* (`extraction_run` + `extraction_edit` + `approveRun` + `payloadHash`/`baseHash` 409 + `assertEditable` RUN_LOCKED + idempotent ingest by `source.hash`), because they are discipline-neutral facts about "a reading of one document revision". Do **not** extend `lib/pid/*` or `lib/db/repos/pid.mjs`:
* separate pure modules `lib/sld/{vocab,draft,graph,review,registers,compare}.mjs`, repo `lib/db/repos/sld.mjs`, routes `app/api/sld/*`, page `app/sld/*`;
* a *small shared* helper only where the logic is truly identical (the review state machine and `hashOf`-style canonicalization), extracted **in a separate, behaviour-preserving PR with P&ID tests as the guard**, or duplicated deliberately (preferred for Phase 12: duplication costs ~100 lines, coupling costs P&ID regressions);
* the P&ID repo filters `pass_name='pid'` everywhere; the SLD repo filters `pass_name='sld'` — neither can read the other's runs.

### 6.2 What reuse requires in shared code (the coupling that cannot be avoided) 
1. `lib/db/repos/review.mjs:32` excludes P&ID by deny-list. An SLD run would appear in the **isometric weld-register review queue** unless excluded. Fix: change to an allow-list for the isometric passes **or** add `'sld'` — either edits shared production code and needs a regression test (isometric queue unchanged; neither P&ID nor SLD runs listed). [Risk R1]
2. `app/api/documents/route.js:78` whitelists `docType`. Add `sld`. [one line]
3. The other readers of `extraction_run` (§2 item 6) must be confirmed to ignore a run with no welds/spools. [unverified]
4. `lib/platform/areas.mjs` + `db/test/area-coverage.mjs` for the new routes; `tile-apis` map.

### 6.3 Hybrid extraction pipeline
```
 PDF sheet ─► (A) deterministic: vector paths + embedded text (pdf.js text layer; geometry from content stream)
          ├─► (B) OCR for rasterized sheets (existing OCR queue/runtime where present; evidence = text + bbox + confidence)
          ├─► (C) vision/LLM: PROPOSALS only (symbol class, grouping, tag↔symbol association, legend interpretation)
          └─► (D) deterministic normalization + validation (never the model)
                         └─► DRAFT (all items `extracted`) ─► human review ─► approval (APPROVE_REGISTER) ─► [separate, explicit] promotion
```
Rules (carried over from Phase 11 and made explicit):
* A reader (A/B/C) may only create `extracted` records; any status/approval it sends is ignored (`sanitizeItem`-style).
* A symbol outside the class vocabulary is `UNKNOWN`. A class is never inferred from the tag letters (a `TR-` prefix does not make a transformer); a legend hint is kept as an attribute, not as the class.
* A rating is read only from printed text associated to the symbol with evidence; an association made by proximity alone is stored as a *candidate* (`ambiguous`) unless the sheet prints an explicit leader/box/callout.
* **Geometry may support connectivity only as evidence of a drawn line between two symbols' connection points** (vector line endpoints coincide within a tolerance with ports); it never infers a connection from two symbols standing close, nor across a line crossing without a junction dot (the SLD convention for a crossing vs a joint is a legend item that must be read, else the crossing is `ambiguous`).
* Evidence per record: `{kind, text, bbox(normalized), confidence}` plus `page`; confidence is the reader's, never recalculated into certainty.
* The original PDF stays the governing source; the viewer shows readings as overlays, labelled as proposals.
* No OCR runtime, vision model or SLD sample is available in this environment: nothing in this section is *measured* (§10).

### 6.4 Linking to existing records without creating any
`refs.tagId` / `refs.cableId` are set only (a) by a person choosing the record, or (b) by a deterministic **unique** match: normalized tag text → exactly one `tag` of the project (same rule as `matchTag`; two candidates → `multiple`, none → `none`). The result is a **link proposal** (`unique / multiple / none`), exactly Phase 11's asset-link proposal. **No `tag`, `asset_master`, `cable` or `subsystem` row is ever created from a draft.** Creating a missing tag is a separate human action through the existing `upsertTag`/equipment import, after which the link is confirmed.

### 6.5 Validation (new category `sld`, rules `S_*`; one `make()` finding shape: code, entity UID, document, revision, page, severity, evidence, explanation, suggested action, and `nature`)
`nature` ∈ **error** (engineering contradiction on evidence), **missing** (information absent), **warning** (suspicious, not contradictory), **ambiguous** (several readings possible). Rejected/superseded items are ignored. A missing value is never an error and never "correct".

| Code | Rule | nature |
|---|---|---|
| S_TAG_DUP | same normalized tag on two live items of the sheet (not a legitimate repeat such as an off-page connector) | error |
| S_TAG_NONE | equipment/feeder with no printed tag | missing |
| S_LINK_NONE / S_LINK_MULTI | tag matches no / several project tags | missing / ambiguous |
| S_RATING_MISSING | transformer/breaker/busbar/switchboard without a printed rating that its class needs | missing |
| S_RATING_INVALID | non-positive or unparseable rating; unit missing | error |
| S_VOLTAGE_TRANSITION | a power edge joins two voltage levels with no transformer between (and the levels differ by more than the stated nominal set) | error (only when both voltages are printed) |
| S_TRANSFORMER_DATA | transformer missing HV/LV voltage or rating; `lv`≥`hv` | missing / error |
| S_FEEDER_NO_DEST | feeder with no destination edge | missing |
| S_FEEDER_AMBIG | feeder reaching ≥2 candidate loads/buses | ambiguous |
| S_BUS_AMBIG | a feeder/breaker could belong to two bus sections (crossing, coupler state unknown) | ambiguous |
| S_OFFPAGE_UNCONFIRMED / _UNRESOLVED / _AMBIG | off-page status per §7 | missing / missing / ambiguous |
| S_CABLE_NOT_IN_REGISTER | SLD cites a `cableNo` absent from the cable register | warning (the register may lag) |
| S_CABLE_CONTRADICTS | SLD printed cable spec/size/voltage vs `cable` row differ (cores, size, rating, from/to) | error when both are present and unambiguous; shows both values, changes neither |
| S_CABLE_FROM_MISMATCH | register `from_ref`/`to_tag` ≠ the equipment the SLD joins that cable between | error / warning by certainty |
| S_PROTECTION_REF | protection device with no controlled breaker, or a CT/VT with no relay | missing |
| S_PROTECTION_FN_UNKNOWN | ANSI function printed that is not in the closed list | warning (kept, flagged) |
| S_REGISTER_CONTRADICTS | printed rating/voltage vs `asset_master`/tag description (when present) | error with both values |
| S_NO_EVIDENCE / S_LOW_CONFIDENCE / S_SYMBOL_UNKNOWN | as P&ID | missing / warning / missing |
| S_WRONG_REVISION | an item stamped for another document/revision | error |
| S_REV_CHANGED | revision-to-revision change (from compare) | info |
No rule infers an engineering value (no default voltage, no "typical" rating, no settings).

---

## 7. Multi-sheet connectivity strategy [proposal]

1. **Off-page connector** = item `cls:"connector"` with `targetSheet` (document number), `circuitRef` (the circuit/feeder/cable label printed at the connector) and `direction`.
2. Resolution, per connector — status only, never adjacency:
   * target drawing not in the project (`document`, `doc_type='sld'`) → `unresolved`;
   * target exists but its draft has not been read → **`unconfirmed`** (a directory match proves nothing);
   * target draft read: the far sheet must hold **exactly one** compatible reciprocal connector (points back at this sheet; same `circuitRef` when this one names one — normalized by whitespace/case only; a missing or different `circuitRef` is **not** a match); one → `resolved`, several → `ambiguous` (candidates listed), none → `unconfirmed`.
3. A `resolved` off-page link joins two *drafts*, so it adds **no adjacency inside a draft**; cross-sheet traversal is a query over resolved links (explicit, reviewable), and an unconfirmed link is never traversed.
4. **Dependency on Phase 11.1 (PR #86):** the rules above are exactly the corrected P&ID rules of PR #86 (directory ≠ proof; line reference must match; unconfirmed adds no adjacency). At `fe7bd98` the P&ID `resolveOffpage` still marks a connector `resolved` when the target merely exists in the directory, and falls back to unfiltered connectors when no line matches. **Phase 12 must not copy that code**; it must implement the corrected semantics from its own tests (or reuse the code only after #86 merges). Consequently this audit's SLD design does not depend on #86's code.
5. In production no peer drafts are loaded by the P&ID repo today (`getDraft` passes the directory only); the SLD repo must load peer drafts of the project's other SLD sheets explicitly, **approved ones first**, and mark the status basis ("peer draft approved/unapproved") so a link confirmed against an unapproved peer is visibly weaker.
6. False connectivity is prevented structurally: edges need evidence; geometric edges need port coincidence; crossings without a junction are `ambiguous`; reciprocal + circuit match for off-page; busbars are *sections* so a coupler's normally-open state is explicit and a section is never merged with another by name.

## 8. Revision and approval strategy [proposal]

* One SLD sheet revision = one `document` row (`doc_type='sld'`, existing `UNIQUE(project_id,doc_no,revision,sheet_no)`); revisions linked with the existing `parent_document_id` lineage (`createRevision`/`linkRevision`). MDR/issue purpose unchanged.
* One live draft per document revision; ingest is idempotent by `source.hash`; a different reading of a signed-off draft is refused (RUN_LOCKED). Change after approval = new revision.
* **Revision isolation:** UIDs are born per draft and never copied. Comparison (`compareSld`) proposes `mapped/candidate/ambiguous/added/removed/changed/renumbered`; mappings are **explicit and one-to-one, same class**, stored on the **target** draft (`payload.mappings`, since `revision_carry_map.cls` cannot hold SLD classes); a signed-off target refuses mappings; approved data is never overwritten.
* **Approval:** per-record review (APPROVE_REGISTER for sign-off, EDIT_EXTRACTION for edits) → `approveRun` (who, when, sha256). Approval makes the *draft* authoritative **as a reading of the drawing**; it does not mutate any register.
* **Promotion to authoritative registers is a separate, explicit, per-record action** (not in scope of Phase 12's first deliverable): e.g. "create tag `T-101` from this approved transformer" via `upsertTag`, or "record this printed rating on the asset" — each with a reason, audited, never bulk-automatic, never overwriting a differing existing value (conflict requires a reason, as the intake does).

---

## 9. UI/UX workspace proposal [proposal]

Route `/sld` (nav under Electrical, after the cable board), built on `WorkspaceFrame` like `/pid` and `/piping`:
* **Explorer:** the project's SLD sheets (doc no · rev · sheet · draft status), multi-sheet picker.
* **Viewer:** the PDF page as an image + overlays (`SldViewer`, same zoom/pan/selection model as `PidViewer`); overlay colour = review status; edges drawn as polylines only where evidence geometry exists; the selected item's connected set highlighted; busbar sections drawn as bands; labels show tag + confidence; a persistent legend states "readings are proposals; the PDF governs".
* **Engineering panel tabs:** Overview · **Equipment** (transformers, switchboards, breakers/isolators, loads) · **Busbar** (sections, couplers, normally-open state) · **Feeder** (way, destination, rating, cable) · **Protection** (devices, functions, settings *reference*) · **Cable** (SLD cable refs vs register, side by side) · **Connectivity** (stated edges, off-page with status) · Validation (`ValidationPanel`, category `sld`) · Compare.
* **Two-way selection sync:** row ⇄ overlay (uid), "go to" centres the viewer; selection highlights connected items.
* **Review:** per row — edit (correction, original kept), approve, reject (reason required), reopen; draft sign-off only when nothing is undecided and no engineering error is open.
* **Navigation to existing records:** an item with `refs.tagId` links to `/asset?tag=`, with `refs.cableId` to the `/electrical` cable detail, the sheet to `/documents`; an item with no link shows the link proposal (unique/multiple/none) and a "create tag" action that opens the *existing* tag/equipment form — it never creates silently.
* Light/dark/phone parity with P&ID; tables are display-only with edits in `FormDialog` (project rule).

---

## 10. Test strategy and evaluation dataset requirements

### 10.1 Real-data availability [verified]
* The repository's labeled evaluation data (`eval/cases/golden/drawings/*.pdf`, 55 files; `eval/README.md`) are **isometric** drawings (`25-10xx-SHn-0`). The P&ID harness `eval/pid/cases/*.json` (8 cases) is **synthetic** by construction and says so.
* No SLD PDF, DWG/DXF, labeled SLD ground truth, or SLD-like file exists in the repository. The session's uploaded files (isometrics, images, spreadsheets, one unidentified PDF whose text layer could not be read here) contain **no identifiable SLD**.
* **Therefore SLD recognition accuracy cannot be measured and no accuracy number may be stated.** Any synthetic fixture in Phase 12 is a *regression* fixture for the deterministic layer and must be labeled synthetic in its name, its output and the PR; it must never be reported as engineering accuracy.

### 10.2 Minimum sample package for a meaningful evaluation (to be supplied by the project)
* ≥ 15 real SLD sheets from ≥ 3 projects/engineering houses, covering: MV single-source, MV/LV with transformer, double-ended with bus coupler (normally open and closed), MCC with motor feeders, DB with outgoing ways, generator/UPS if present, multi-sheet set with off-page connectors (≥ 2 sets of ≥ 3 sheets), a revision pair (rev A→B) with real changes, at least one scanned/rasterized sheet and one vector PDF.
* Each with **human-labeled ground truth**: every equipment tag + class, every printed rating (verbatim), every connection (from/to/via), every off-page link, cable references, protection references; labeled by an electrical engineer, **double-labeled on ≥ 5 sheets** with the disagreement rate reported.
* A held-out split (never used to tune rules/prompts) and a registered baseline file, same as `eval/baseline.json` practice.
* Per-category metrics (a missing value is never correct): equipment tag P/R, class accuracy, rating exact-match (verbatim) P/R, connection P/R, bus-section assignment accuracy, feeder-destination accuracy, off-page resolution accuracy and **wrongly-resolved rate (must be 0)**, cable-reference match, duplicate detection, false-positive rate.

### 10.3 Automated tests planned for the implementation
Pure (`db/test/sld-intelligence.mjs`): contract/sanitizer (reader cannot approve; unknown symbol `UNKNOWN`; class never from tag letters; edges need evidence/endpoints; Fact bases), graph (no proximity edge; crossing ambiguity; coupler state; sections distinct), off-page (the 10 PR-#86-style cases), validation (each `S_*` with error/missing/warning/ambiguous separation; no default values), compare (explicit mapping, one-to-one, same class, target-side storage, signed target refuses), link proposals (unique/multiple/none, nothing created).
Server: ingest idempotency, RUN_LOCKED, stale 409, authorization/viewer refusal, project isolation, **review-queue exclusion of `sld`**, concurrency of two ingests, no write to `tag`/`asset_master`/`cable` (row counts before = after), cable register unchanged by any SLD action.
Regression guards: isometric queue/`parseSheet` untouched, P&ID suite unchanged, `db/test/electrical.mjs` unchanged. Browser drives for `/sld` (light/dark/phone, selection sync, correction/approval, off-page unconfirmed, navigation to asset/cable) plus the P&ID and isometric regressions. Every guard proven by reverting the code it protects.

---

## 11. Migration decision

**No migration is required for the first implementation. None is proposed.**

| Requirement | Met by | Why no schema change |
|---|---|---|
| Store SLD drafts, approval, audit | `extraction_run` (`pass_name='sld'`, `payload jsonb`, `approved_*`), `extraction_edit` | `pass_name` is free text; Phase 11 proved the pattern |
| File sheets and revisions | `document` (`doc_type` free text) + `mdr` | API whitelist is code |
| Revision mappings | on the target draft payload | as Phase 11 (CHECK on `revision_carry_map.cls` unchanged) |
| Cable references | `cable.cable_no` (project-unique) | reference by id/no, no new registry |
| Link to equipment | `tag` | proposals only |

**Concrete requirements that existing structures cannot meet well, with alternatives (decision deferred to the owner, not made here):**
1. *Authoritative electrical ratings per equipment* (voltage, kVA, rated current, breaking capacity, impedance) — `asset_master` has none. Alternatives: (a) keep ratings only in approved SLD drafts (no promotion; zero schema; ratings not queryable across drafts, no cross-register contradiction beyond SLD↔cable); (b) a project-scoped value in `asset_master` via an additive migration (`asset_master` columns or a narrow `asset_electrical` table keyed by `tag_id`, append-only history like `asset_master_revision`); (c) store promoted ratings as typed `custom-fields` if the existing custom-fields repo (`lib/db/repos/custom-fields.mjs`) can type them [unverified]. Recommendation: **start with (a)**, build validation S_REGISTER_CONTRADICTS against whatever exists, and decide (b) only when promotion is wanted.
2. *Cable From end as a record* — `cable.from_ref` is text. Alternative: add `from_tag_id` (additive, nullable, resolved by `matchTag`) — a tiny migration **in the electrical module**, not in the SLD feature; or compare SLD↔register on text with `matchTag` (no schema). Recommendation: compare on text first (S_CABLE_FROM_MISMATCH reports *uncertain* when `from_ref` does not resolve to one tag), add `from_tag_id` only if the owner wants the register itself corrected.
3. *`doc_type` vocabulary* — free text; no migration.
No migration was created or run in this audit; any later one is additive-only and the owner runs it (never on production by this tooling).

---

## 12. Risks, dependencies and implementation phases

### 12.1 Risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | Shared `extraction_run` consumers/queue treat an SLD run as isometric | allow-list the isometric queue; audit each reader (§2.6, 6.2); queue-exclusion test |
| R2 | **No real samples** → accuracy unknown, easy to over-claim | label every fixture synthetic; refuse to quote accuracy; sample package (§10.2) is a Phase-12 gate for any accuracy claim |
| R3 | False connectivity (line crossings, proximity, shared bus name) | evidence-only edges; port-coincidence geometry; crossings ambiguous; explicit sections; off-page reciprocal + circuit match |
| R4 | Rating misattribution (a number printed near two symbols) | association needs leader/box; else candidate `ambiguous`; never default |
| R5 | Protection data: reading/inferring settings is unsafe | store only printed function numbers and a **settings document reference**; never a setting value; no setting is calculated |
| R6 | Divergence from the P&ID off-page rules (PR #86 pending) | SLD implements the corrected semantics from tests; do not copy `fe7bd98` P&ID logic |
| R7 | "MCC" ambiguity (Motor Control Centre vs Mechanical Completion Certificate) | never key on the string; classes come from symbols/legend, tags from the register |
| R8 | Scope creep into load-flow/short-circuit/coordination studies | out of scope: no electrical calculation beyond lossless parsing and the listed checks |
| R9 | Rating home undecided (§11.1) | decision for the owner before promotion work |
| R10 | Disk/test infra (db:test leaks large temp DBs under /tmp when interrupted) | unrelated to design; noted from this session's experience |

### 12.2 Dependencies
Real SLD samples + labels (blocking for any accuracy claim); owner decisions on §11.1/§11.2; PR #86 merged (or SLD implements its semantics independently); an OCR runtime and/or model access in the delivery environment for pass B/C (vector/text-layer extraction does not need them).

### 12.3 Phases
* **12.0** (this audit).
* **12.1 Contract & engine (pure):** `lib/sld/{vocab,draft,graph,review,registers,compare}.mjs`, validation `S_*`; synthetic regression fixtures (labeled); no DB.
* **12.2 Persistence & API:** `lib/db/repos/sld.mjs`, `app/api/sld/*`, `doc_type='sld'` whitelist, review-queue allow-list, areas/tile map; server tests incl. isolation and "no register writes".
* **12.3 Readers:** vector/text-layer deterministic reader first; OCR adapter; vision proposal adapter (sanitized); evaluation harness skeleton that *refuses to report accuracy without a real-labeled split*.
* **12.4 Workspace UI:** `/sld` page, viewer, panel, nav, drives, light/dark/phone.
* **12.5 Cross-register checks:** SLD↔cable (and ↔asset if §11.1 decided), link proposals, promotion actions (explicit, audited) — only after the owner's decisions.
* **12.6 Real evaluation:** run on the sample package; report per-category metrics honestly; set baselines.
Each phase: own branch, own draft PR, all five CI checks, no merge without the owner's «مرج کن».

---

## 13. Explicit acceptance criteria for Phase 12 (implementation)
1. An SLD sheet is filed as a `document` (`doc_type='sld'`) through document control; revisions use the existing lineage; no second document registry.
2. SLD drafts live in `extraction_run` (`pass_name='sld'`) with idempotent ingest, stale-edit 409, RUN_LOCKED after sign-off; the isometric weld review queue and the P&ID workspace are unchanged and do not list SLD runs (tests prove both).
3. Every item has a stable UID, normalized bbox, page, confidence, evidence and review status; every electrical attribute is a Fact with `basis` ∈ printed/extracted/calculated/unknown; an absent value is `unknown`, never defaulted.
4. A reader (OCR/vector/vision) can only produce `extracted` records; no automatic approval anywhere; approval records approver/time/hash.
5. No SLD action creates or changes a `tag`, `asset_master`, `cable`, `subsystem` or any register row without an explicit, audited human promotion (row-count tests before/after).
6. Cable references use existing `cable_no`/`cable.id`; no cable registry is created; SLD↔register contradictions are reported with both values and change neither.
7. Connections exist only with evidence; no proximity edge; crossings without a junction are `ambiguous`; busbar sections are distinct; off-page links are `resolved` only on the target's own draft with exactly one compatible reciprocal connector (and matching circuit reference when named); unconfirmed links add no adjacency (tests incl. the 10 off-page cases).
8. The validation set of §6.5 is implemented in the Validation Center with errors / missing / warnings / ambiguous separated; every finding carries code, UID, document, revision, page, severity, evidence, explanation, suggested action.
9. Revision comparison uses explicit, one-to-one, same-class mappings stored on the target draft; UIDs never copied; approved data never overwritten.
10. `/sld` workspace: viewer with overlays, zoom/pan, two-way selection sync; tabs Equipment/Busbar/Feeder/Protection/Cable/Connectivity/Validation/Compare; correct/approve/reject/reopen; navigation to Asset/Cable/Document; light/dark/phone verified in a real browser; P&ID and isometric browser regressions pass.
11. No change to `lib/engine.js`, the isometric extraction pipeline, cable/IR behaviour or existing K110 data; no migration unless the owner approves one of §11's alternatives with its justification.
12. Final verification on the final SHA: `db:test`, `db:test:pg`, `eval:check`, `next build`, browser drives. **No accuracy claim** until the real sample package (§10.2) has been labeled and run; until then every SLD metric is explicitly "synthetic regression, not engineering accuracy".

## 14. Factual correction to the master plan
`docs/digital-epc/00-master-plan-alignment.md`, open item 9 reads "خواندن P&ID و SLD … هنوز" as one open item. The audit established that the **P&ID half exists since Phase 11** (draft/review/graph/validation/comparison layer, PR #85; recognition accuracy on real sheets still unmeasured) while the **SLD half is unbuilt** (§1.4). The item was split accordingly (that file only; no other doc changed).
