# Phase 12 — SLD Intelligence & Electrical Engineering: architecture audit (Step 0)

Audit and design only. Nothing in this document is implemented; no production code, schema or test was changed.
Audited against `master` @ `fe7bd98ae31e1cc7cb33367d3bcbe871ce85f565` (Phase 11, PR #85). PR #86 (Phase 11.1, off-page integrity) was **not merged when Step 0 was written**; it has since been **merged** (squash, 2026-11-07T17:22:19Z, master `ec56976848032cfd5cd1404b18b25ee5a3c89e5d`, see §16.1). Step-0 statements about the P&ID rules describe `fe7bd98` and are kept as historical; where Phase 12 relies on a P&ID rule that #86 changed, §7.4 and §16.1 say so.

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
| Document intake | `db/migrations/063_doc_intake.sql`, `lib/intake/*`, `lib/db/repos/intake.mjs` | reads received documents (pdf-text / xlsx) into proposals; item `kind` was CHECK-limited to `drawing, equipment, line, instrument, subsystem, system` in 063 and widened by 066 — **no `sld` kind** (correction in §15.8: migration 066 added `cable` and `structure`). Only approved revisions (code 1/2) are read. |
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
4. **Dependency on Phase 11.1 (PR #86):** the rules above are exactly the corrected P&ID rules of PR #86 (directory ≠ proof; line reference must match; unconfirmed adds no adjacency). At `fe7bd98` the P&ID `resolveOffpage` still marks a connector `resolved` when the target merely exists in the directory, and falls back to unfiltered connectors when no line matches. **Phase 12 must not copy that code**; it must implement the corrected semantics from its own tests (or reuse the code only after #86 merges — **#86 is now merged**, but electrical semantics still require their own validation, §16.4). Consequently this audit's SLD design does not depend on #86's code.
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
| R6 | Divergence from the P&ID off-page rules (PR #86 — merged since; see §16.1) | SLD implements the corrected semantics from tests; do not copy `fe7bd98` P&ID logic |
| R7 | "MCC" ambiguity (Motor Control Centre vs Mechanical Completion Certificate) | never key on the string; classes come from symbols/legend, tags from the register |
| R8 | Scope creep into load-flow/short-circuit/coordination studies | out of scope: no electrical calculation beyond lossless parsing and the listed checks |
| R9 | Rating home undecided (§11.1) | decision for the owner before promotion work |
| R10 | Disk/test infra (db:test leaks large temp DBs under /tmp when interrupted) | unrelated to design; noted from this session's experience |

### 12.2 Dependencies
Real SLD samples + labels (blocking for any accuracy claim); owner decisions on §11.1/§11.2; PR #86 (now merged) or SLD implementing its own semantics; an OCR runtime and/or model access in the delivery environment for pass B/C (vector/text-layer extraction does not need them).

### 12.3 Phases
> **Superseded by §16.2/§16.3:** the phase split below mixed intake, extraction and topology; use the roadmap of §16.2.

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
> **Superseded by §16.5–§16.7:** these criteria described the whole of SLD intelligence; they are now split per phase (12.2 intake/persistence, 12.3 extraction, 12.4 topology).

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


---

# 15. Phase 12.1 — Architecture Closure

Documentation, source inspection and decisions only. Base: `master` @ `f0e239b9e6b1c80548259304e74cb7deb7e07b04` (audit PR #87 merged). Nothing implemented; no production code, migration or test changed.
PR #86 (Phase 11.1) is reviewed separately in §15.7 and is **not** a dependency (it has since been merged, §16.1).
Evidence labels: **[inspected]** source read at the base SHA; **[ran]** executed here against the base SHA; **[probe]** an executed scratch probe on a throwaway DB (not committed); **[not verified]**.

## 15.1 Complete `extraction_run` consumer inventory

Searched the whole repository (`app lib` code, `db/migrations`, `tools`) for `extraction_run`, `extraction_edit`, `pass_name`, `reporting.current_run` and the run-addressed routes. Facts that govern everything below **[inspected]**:
* `extraction_run.pass_name` is free text; **isometric runs carry `pass_name` NULL**: the only writer, `lib/db/repos/runs.mjs createRun`, takes `passName` from the request body of `app/api/runs/route.js`, and the isometric page (`app/piping/page.jsx`) never sends one. P&ID drafts use `'pid'` (`lib/db/repos/pid.mjs`).
* `reporting.current_run` (`035_current_revision.sql`) is `DISTINCT ON (project_id, document_id)` over **every** run with `engine_error IS NULL` of a document with `superseded_by IS NULL` — it has **no pass or document-type filter**. Every consumer that reads it without joining `weld`/`spool` sees P&ID (and would see SLD) runs.
* DB triggers on `extraction_run` (`005_review.sql`): `lock_on_approval` stamps `locked_at`; `refuse_locked_edit` rejects any change of `payload`/`validation_checks` of a locked run. They are pass-agnostic — a strong reason to reuse the table for SLD drafts.
* `intake_run`/`intake_item.run_id` (`063_doc_intake.sql`) belong to **document intake**, a different table; not `extraction_run`.

Legend — **Filter**: is `pass_name` (or doc type) filtered? **SLD risk**: S = safe (reaches only weld/spool rows keyed by `extraction_run_id`, which an SLD run never has); L = **a run of another pass can enter an isometric workflow or figure**.

| # | File · function | Query / method | Pass types accepted | Filter | SLD risk · required isolation |
|---|---|---|---|---|---|
| 1 | `lib/db/repos/review.mjs` `reviewQueue` | `extraction_run r JOIN document d … status='extracted' AND COALESCE(pass_name,'') <> 'pid'` | all but `pid` | deny-list `pid` only | **L** — add `sld` (or doc-type allow-list) |
| 2 | `review.mjs` `applyCorrection` (via `app/api/runs/[id]/edits`) | `SELECT * FROM extraction_run WHERE id=$1`, applies isometric path edits + `touchesSheetData` | any run id | none | **L** — a run id of another pass can be sent through the isometric correction path; reject non-isometric runs |
| 3 | `review.mjs` `hotspots` | `SELECT path,before_value,after_value FROM extraction_edit WHERE project_id=$1` | every edit of every pass | none | **L** — **[probe]** one P&ID correction already raises `totalEdits` to 1 |
| 4 | `review.mjs` `approvedRunFor` | by `document_id`, `status='approved'` | any | document-scoped | S (document-scoped; an SLD document is never an isometric one) |
| 5 | `lib/db/repos/runs.mjs` `createRun`, `saveRegister` | INSERT run; INSERT spool/weld for the run | any `passName` from the body | none | **L (write side)** — `/api/runs` accepts any `passName` and any `documentId`; reserve `pid`/`sld`, require an isometric document |
| 6 | `runs.mjs` `approveRun` | digest of payload + welds of the run, UPDATE status | any | none | S — deliberately shared (the P&ID repo reuses it); empty weld set for SLD |
| 7 | `runs.mjs` `latestRunForDrawing` | `extraction_run JOIN document WHERE doc_no AND sheet_no` | any | none | **L (low)** — keyed by `doc_no`+`sheet_no`, type-agnostic; harmless while document numbers are unique across types, but not enforced (§15.2) |
| 8 | `runs.mjs` `latestRunForDocument` (used by `validation.mjs validationFor`) | latest run of a document | any | none | **L** — `/api/validation?documentId=` of a P&ID/SLD document would run the **isometric** `validate()` on a foreign payload; guard by document type |
| 9 | `app/api/runs/route.js` POST | lock document, `SELECT payload … document_id`, carry identities from the last run | any document | none | **L** — must refuse a non-isometric `documentId` |
| 10 | `app/api/runs/[id]/route.js` GET; `…/approve`, `…/diff`, `…/edits`, `…/ndt-sample` | run by id JOIN document | any run id | none | **L** — id-addressed isometric endpoints do not check the pass; a P&ID/SLD run id works on them |
| 11 | `lib/db/repos/revision-lifecycle.mjs` `lineageOf`, `carryForward`, `createRevision` | runs of the revision chain; carry of weld/spool/support/equipment identity | any | none (**`doc_type` appears only in `createRevision`'s `registerDocument` call**) | `lineageOf`/`createRevision` are type-agnostic — good for SLD reuse; **`carryForward` is isometric-only and unguarded → L** |
| 12 | `lib/db/repos/revisions.mjs` `loadRun`, `compareRuns`, `compareWithPrevious` | run by id + weld table; previous by `doc_no`/`sheet_no` | any | none | **L (low)** — id-addressed; guard like #10 |
| 13 | `lib/db/repos/log.mjs` DERIVED (piping) | `extraction_run r JOIN document d WHERE approved_by IS NOT NULL` → label `'رجیستر جوش ' || doc_no` | any approved run | none | **L** — **[probe]** an approved P&ID draft appears in the activity log **as a weld register** |
| 14 | `lib/db/repos/line-list.mjs` | latest run per document of a `doc_no`+`sheet` (revision list) | any | none | S (by drawing number; type-agnostic by design) |
| 15 | `lib/db/repos/piping-hub.mjs` `pipingHub` | `count(*) … FROM reporting.current_run c JOIN extraction_run r` → `drawings`, `drawingsApproved` | any | none | **L** — **[probe]** a project with only an approved P&ID shows `drawings: 1, drawingsApproved: 1` |
| 16 | `lib/db/repos/piping-reports.mjs` (register query at :30–36 and weld/spool reports :48, :92, :141, :155) | `current_run JOIN extraction_run JOIN document` (list), `current_run JOIN weld/spool` | any | none | weld/spool queries S; **the drawing-list query at :30–36 is L [inspected]**; the `weld-log` report did **not** list the P&ID drawing in the probe, so the :30–36 query's exposure is *not confirmed* — treat as unverified |
| 17 | `lib/db/repos/joint.mjs` (:56–65, :167–169, :334–342) | welds JOIN run; edits of runs of welds; **every other current run's `payload`** scanned by `refsOfPayload` | any | none | weld queries S; :337 reads the full payload of every current run (incl. P&ID/SLD) — functionally tolerant (`refsOfPayload` reads `weldList`/`sheetMarkup`, absent → nothing) but loads large JSON needlessly **L (performance)** |
| 18 | `lib/db/repos/assumptions.mjs` `register-missing` (:176–186) | documents with a run but no `current_run` row | any | none | S (a P&ID/SLD run never sets `engine_error`) |
| 19 | `app/api/overview/route.js` (:55–60) | `COUNT(DISTINCT d.id)`, `COUNT(DISTINCT r.document_id) FILTER (status='approved')` over `document LEFT JOIN extraction_run` | any | none | **L (semantic)** — **[probe]** the P&ID document counts as an approved document; decide whether "documents approved" should be type-aware |
| 20 | `lib/db/repos/register-persistence.mjs` (:127) | approved run of the **same document** blocks BOM edits | any | document-scoped | S |
| 21 | `field.mjs` (:55), `workfront.mjs` (:94), `coating.mjs` (:317), `piping-execution.mjs` (:124, :310), `app/api/warehouse/route.js` (:27), `lib/contracts/metrics.mjs` (:36) | `spool JOIN reporting.current_run` / `spool JOIN extraction_run` | any | none | S — keyed through `spool.extraction_run_id` |
| 22 | `bom-allocation.mjs`, `iso-equipment.mjs`, `mark-identity.mjs` (`run_id` columns) | store the creating run id with isometric marks | isometric writers only | n/a | S |
| 23 | Reporting views `006/011/012/031/035` (`fact_weld`, `fact_spool`, …) | join `weld`/`spool` to `current_run` | any | none | S |
| 24 | `lib/db/repos/pid.mjs` (all) | every query filters `pass_name = 'pid'` | `pid` | allow-list | n/a (reference pattern) |
| 25 | `lib/pid/draft.mjs` | mentions `extraction_run` in comments only | — | — | n/a |

**[probe]** (throwaway PGlite DB on the base SHA; script not committed): one P&ID document, ingested, one correction, set `approved` →
`hotspots.totalEdits = 1`; `reporting.current_run` = 1 row; `pipingHub.totals.drawings = 1`, `drawingsApproved = 1`; the activity log contains the P&ID as a weld-register approval; `overview` counts 1 approved document; the weld-log report and the review queue did **not** contain it.
**Honest consequence:** Phase 11 isolated the P&ID from the review queue only. Items 3, 13, 15 and 19 are **existing leaks of P&ID drafts into piping figures, already on master**, not a future SLD problem. They affect no weld data but they show a "drawing" and an "approved register" that are not isometrics. This is recorded as a defect of Phase 11 (its audit did not inventory the other readers) and is to be fixed by the same guard Phase 12.2 introduces (or a separate Phase 11.2 fix, owner's choice).

### Is a shared allow-list necessary? — **Yes, a shared predicate; no schema change.**
* The existing approach (a per-pass deny-list in one query) already failed: it protects one of ≥ 5 readers.
* A `pass_name IS NULL` allow-list would match today's isometric data exactly **[inspected]** but is fragile (the API lets a client set any `passName`, and a future isometric pass may be named). The authoritative discriminator is the **document type** set at registration.
* **Selected:** one shared helper (`lib/db/run-scope.mjs` [proposal]) that exports `ISOMETRIC_DOC = "d.doc_type = 'isometric'"` for queries that already join `document`, and `NOT_PID_SLD_PASS` for queries on `extraction_run` alone; applied to rows 1–3, 5, 7–13, 15, 16(list), 19; plus route guards (rows 2, 9, 10) returning 409 `NOT_AN_ISOMETRIC_RUN`; plus reserved pass names (`pid`, `sld`) refused by `POST /api/runs`.
* **Backward-compatibility argument (to be proven by test, not assumed):** every existing document is `isometric` or `pid` (the column default is `'isometric'`; `registerDocument` defaults to it; the only other INSERT is `tools/seed-demo.mjs`, which omits `doc_type` → default). So for a database with no `pid`/`sld` documents each guarded query returns the identical rows. Required test: a **differential test** — seed an isometric-only project, record each guarded function's output before and after the change (byte-identical), then add a `pid` and an `sld` document with approved runs and assert the outputs are **still** identical.
* Alternatives rejected: (a) per-consumer deny-lists (the failure above); (b) a new `reporting.isometric_run` view or an `extraction_run.kind` column (needs a migration; not required); (c) a separate SLD draft table (loses the pass-agnostic lock/approval triggers, `extraction_edit` audit and `approveRun`).
* **Unresolved risk:** the guarded set was derived by reading; a consumer added later that reads `current_run` raw re-opens the leak. Mitigation: a test that greps repository sources for `reporting.current_run`/`FROM extraction_run` outside an allow-listed file list and fails on a new, unreviewed use.

## 15.2 Document intake and MDR

**Two registers exist and must not be conflated [inspected]:** `document` (uploaded sheet revisions; `001_core.sql`; `UNIQUE(project_id, doc_no, revision, sheet_no)`; `doc_type` free text default `'isometric'`) and `mdr_document`/`mdr_revision` (the master document register; `026_document_control.sql`; `UNIQUE(project_id, doc_no)`, `doc_type text`, `discipline text`, purposes IFR/IFA/IFC/AB/VOID). They are linked **only by document number**: `registerBoard` (`lib/db/repos/doc-control.mjs`) matches `upper(document.doc_no)` to `mdr_document.doc_no` (the MDR upsert upper-cases; the upload route does not).

Findings:
1. `app/api/documents/route.js:78`: `const docType = body.docType === "pid" ? "pid" : "isometric";` — **any other value silently becomes `isometric`** (violates the requirement that unsupported types never silently become isometric).
2. `registerDocument` (`lib/db/repos/documents.mjs`) looks up an existing row by `(project, doc_no, revision, sheet_no)` **without the type**: registering the same number/revision/sheet with a different `docType` and the same hash returns the existing row unchanged; with a different hash it raises `REVISION_CONTENT_CONFLICT` — neither reports a *type* conflict.
3. `supersedePrevious`/`currentRevision` select by `(doc_no, sheet_no)` — type-agnostic. Safe only if one document number never spans two types.
4. `createRevision` (`revision-lifecycle.mjs:83`) carries `src.doc_type` — the lineage tool is already type-preserving. `lineageOf` is type-agnostic.
5. MDR/`registerBoard`, `usedRevisionCheck`, `incoming.mjs`, `app/documents/page.jsx` never read `document.doc_type`; the MDR `doc_type` is a human label ("P&ID، ISO، DS…" hint). **An SLD sheet therefore appears correctly in the MDR and transmittal workflows as soon as its `mdr_document` exists — no code change in document control.**
6. `tools/seed-demo.mjs` and `lib/scenario/dm-pump.mjs` register MDR entries with free doc types; none uses `sld`.

**Exact changes required for `docType='sld'` [proposal]:**
* A closed set `DOC_TYPES = ["isometric","pid","sld"]` (`lib/documents/types.mjs`). `POST /api/documents`: absent/`null`/`""` → `isometric` (unchanged); a value (case-normalised) in the set → itself; **anything else → 400 `INVALID_DOC_TYPE`** with the allowed list. (Compatibility: the only client that sends `docType` is the P&ID path; the isometric page sends none — **[inspected]** by search of `app components lib tools`.)
* `registerDocument`: if a row for `(doc_no, sheet_no)` already exists with a different `doc_type` (any revision) → 409 `DOC_TYPE_CONFLICT` (a drawing number keeps one type across its revisions); existing behaviour otherwise unchanged.
* No separate SLD table; `extraction_run` references `document_id`; `parent_document_id` lineage and `superseded_by` are reused. Recommended (non-blocking) convention: MDR `doc_type='SLD'`, `discipline='electrical'`.
* Optional, later: a non-blocking finding when the uploaded type contradicts a recognised MDR label.

**Test cases required (existing types and SLD):** (1) no `docType` → `isometric`; (2) `isometric`/`pid`/`sld` accepted and stored; (3) `'ISO'`, `'sld '`(trailing space is trimmed → accepted), `'SLD'` (case-normalised → `sld`), `'unknown'` → 400, nothing registered; (4) same `doc_no`/rev/sheet registered as `pid` then `sld` → 409 `DOC_TYPE_CONFLICT`; (5) revision B of an `sld` document via `createRevision` keeps `sld` and `parent_document_id`; (6) an `sld` document with an `mdr_document` appears in `registerBoard` with the correct current/construction revision, in a transmittal, and is **absent** from the isometric review queue, weld register and piping counts; (7) the `pid` path (`db/test/pid-intelligence.mjs` S1–S8) unchanged; (8) isometric upload/supersede flows (`db/test/api.mjs`, `doc-control.mjs`) unchanged; (9) uploading an isometric payload to an `sld` document id via `/api/runs` → 409.

## 15.3 Custom Fields capability

Inspected: `lib/db/repos/custom-fields.mjs`, `app/api/custom-fields/route.js`, `components/ui/customColumns.jsx`, `components/ui/TableKit.jsx`, `db/migrations/085_tables_custom_columns.sql`, `db/test/custom-fields.mjs` (**[ran]** 5/5).
* Model: `custom_field(id, project_id, form_key, label, data_type ∈ text|number|date|bool|list, options, seq)`; `custom_value(field_id, row_key, value text, updated_by, updated_at)`, **PK `(field_id, row_key)`**; RLS by project. A *column a project adds to a platform table*; the value is keyed by the table's **display row key** (a string ≤ 200), **not a foreign key to `tag`/`cable`**.
* No units (a `number` is a bare number, normalised to ≤ 10 decimals); no per-value source document/revision; **no history** — `saveValue` overwrites (`ON CONFLICT … DO UPDATE`, only `updated_by`/`updated_at` kept) and a blank deletes the row; `removeField` cascades all values; **no approval state**; the type of a field can change when existing values still parse; **writes need only `VIEW_PROJECT`** (`POST` asserts `ACTIONS.VIEW_PROJECT`) — any member can edit.
* Verdict per requested attribute: voltage + unit, rated current, kVA, frequency, short-circuit rating, transformer impedance, vector group, manufacturer/model, source document/revision, historical changes — **Custom Fields can hold the *text or number* of each as optional project metadata for display in a table; it cannot be the home of authoritative electrical specifications**: no units, no source/revision, no history, no approval, no referential link to the tag, and write access for every member. A vector group or manufacturer as a `text` column is acceptable *as a note*; anything an engineering rule or CMMS export would rely on is not.
* Classification: **optional project metadata** = custom columns (labels, notes, client-specific fields). **Authoritative engineering specification** = typed, unit-normalised, sourced, versioned, approved data (§15.4).

## 15.4 Electrical rating ownership — decision

Facts **[inspected]**: `asset_master` has nameplate columns and design conditions (`design_pressure_barg`, `design_temp_min/max_c`, `design_datasheet_rev_id → mdr_revision`) but **no electrical rating**. `setAssetMaster` (`lib/db/repos/handover.mjs`) **refuses any tag whose discipline is not `equipment`** ("شناسنامهٔ نگهداری برای تگ تجهیز") and is a **whole-row upsert** (an omitted column is written as NULL), with an append-only `asset_master_revision` snapshot per save; `reporting.dim_asset_master` filters `discipline='equipment'`; the CMMS export reads `asset_master`. The design-condition rule `designConditionProblems` is the precedent: *a value is rejected unless it names the datasheet revision it came from*. No code creates `electrical`-discipline tags; motors arrive through the equipment import as `equipment`. The project voltage spec is a single `project.lv_system_voltage_v` (a plant with 690/400/230 V levels cannot be expressed there; `cable.system_voltage_v` is per cable).

| Criterion | A. SLD draft only | B. Extend `asset_master` (typed, versioned) | C. Separate Electrical Nameplate Register linked to Tag / Asset Master |
|---|---|---|---|
| Data integrity | draft payload `jsonb`; typed by contract only | typed columns, but a **wide sparse row** (transformer vs breaker vs motor attributes) for every equipment tag; whole-row replace can null unrelated columns | typed per-attribute rows, closed attribute vocabulary per class |
| Unit normalisation | by the SLD contract (`Fact.unit`); no cross-sheet query | one canonical unit per column; printed text lost unless extra columns | canonical unit per attribute + printed text kept |
| Revision history | immutable approved drafts (DB lock) = history per sheet revision; no per-tag "current value" | `asset_master_revision` snapshots (whole-row) | append-only per attribute (precedent: `asset_master_revision`, `project_assumption_revision`) |
| Approval / audit | draft sign-off (who/when/hash) | `updated_by` only; no approval step | status + approver + time per value, source = `mdr_revision` and/or SLD item uid |
| Reporting / CMMS reuse | none | direct (same table) | a join added to `handoverBoard`/export; `dim_asset_*` view |
| Migration cost | **none** | additive columns **+ relaxing the equipment-only guard + partial-update semantics** (touching a working CMMS path) | additive tables (small), no change to existing ones |
| Compatibility with Asset Master | n/a | **highest risk** (guard, whole-row null-overwrite, CMMS/export columns, view filter) | none (links by `tag_id`; asset_master untouched) |
| Contradiction check SLD↔register | SLD↔cable only | possible | possible (SLD↔datasheet-sourced value) |

**Decision (selected): staged — A now, C when promotion is wanted; B rejected.**
* **12.2–12.4:** A. Ratings live only in the (approved, immutable) SLD draft as `Fact`s; no schema; validation compares the SLD with whatever registers hold (cable, asset design data where present). This is the only option meeting "no migration unless a concrete requirement cannot be met" today.
* **When authoritative per-tag electrical specs are required (owner decision, Phase 12.5):** option **C** as an additive, append-only **attribute-fact register keyed to `tag`** (`tag_id`, attribute key from a closed per-class vocabulary, canonical numeric value + canonical unit + printed text, source = `mdr_revision_id` and optionally SLD run/item uid, status, approver/time, supersession), reusing the design-condition rule ("no value without its source revision"). It does not touch `asset_master`; the CMMS export may *read* it.
* Why not B: the equipment-only guard and the whole-row null-overwrite make extending `asset_master` the highest-regression option for a path already in production use (CMMS handover), and a 10-column sparse extension for every equipment tag is poor modelling.
* Why not Custom Fields: §15.3.
* **Unresolved:** which discipline the project gives transformers/switchboards (`equipment` vs `electrical`) — C must accept both; the voltage-level model (multiple levels) is outside `project.lv_system_voltage_v` and needs its own decision; unit canonicalisation list (V, A, kVA, Hz, kA, %) to be fixed by an electrical engineer, not by this audit.

## 15.5 Cable endpoint identity — decision

Facts **[inspected]**: `cable(cable_no UNIQUE per project, from_ref text, to_ref text, to_tag_id → tag)`. `importCableSchedule` sets `to_tag_id` **automatically** from `matchTag(to) || matchTag(from)` — a unique exact whole-token match; two tags in one field → null (no attach). `correctCable` can set/clear `to_tag_id` by hand (and then sets `subsystem_id` from the tag). `to_tag_id` **drives readiness**: `deriveTagElectrical` answers a tag's `electrical` step from the cables feeding it. `from_ref`/`to_ref` are otherwise display-only (`field.mjs`, `eps-scope.mjs`, `fact_cable`, the board). Document intake can propose cable `from/to/spec/length` from a cable list (`lib/intake/extract.mjs`, 066) and applies them only on a person's decision, a conflict needing a reason.

| | A. Keep text; resolve both ends by proposals | B. Add `from_tag_id` | C. Reusable endpoint relationship model |
|---|---|---|---|
| Switchgear/MCC/DB/transformer/motor/load ends | by unique tag match, else unresolved | only if a tag exists; NULL conflates "unresolved", "ambiguous" and "no tag exists" | each end is a row: resolved tag, or a status (`resolved`/`ambiguous`/`unresolved`) + candidates |
| Ambiguity / unresolved | held in the SLD draft / proposal, never in the register | **cannot be represented** | represented |
| Provenance (who/what/when decided) | in the draft's review trail | none | per end |
| RLS / project isolation | no new table | column on an RLS table | new RLS table |
| SLD↔cable reconciliation | compare SLD edge endpoints to `matchTag(from/to)` text | compare to two tag ids | compare to endpoints |
| Legacy text / cable ids | untouched | untouched | untouched (additive) |
| Migration | **none** | additive column (+ backfill by unique match: a *decision about uncertain tags if automatic*) | additive table |
| Risk to existing behaviour | none | `to_tag_id` semantics must not change; asymmetric with `to_tag_id` | must not disturb `to_tag_id`-driven readiness |

**Decision (selected): A now; C (not B) if the owner later wants the register itself to carry resolved ends.**
* **A (Phase 12.2–12.4):** no migration. The SLD draft stores, per cable reference, `cableNo`, `refs.cableId` (set only by a person or by exact unique `cable_no` match) and, for each *end*, a **link proposal** against project tags (unique / multiple / none) — computed, never persisted outside the draft. Reconciliation `S_CABLE_FROM_MISMATCH` compares the SLD's from/to equipment with the register's `from_ref`/`to_ref` text via the same exact-token rule, and reports **uncertain** when a text does not resolve to exactly one tag. **A cable is never attached to an uncertain tag**; the existing automatic `to_tag_id` rule of the *import* (unique exact match) is unchanged and is not extended to SLD.
* B is rejected: one new nullable column cannot say *why* it is NULL, so it cannot satisfy "unresolved and ambiguous endpoints" and invites a bulk backfill that is exactly an automatic attachment.
* C, if wanted, is additive and independent: `cable_end(cable_id, end ∈ from|to, tag_id NULL, status, candidates, source (sld item uid / manual / import), decided_by/at)` with RLS like `cable`; it **never replaces** `to_tag_id`/`from_ref`/`to_ref`, which stay the legacy truth until each end is explicitly confirmed. Not built here.
* **Unresolved:** whether `from` should ever feed readiness (today only `to_tag_id` does); whether bare tokens such as `MCC`/`SWGR` (seen in fixtures: `MCC-12`, `SWGR`) are board tags or free text — the exact-token rule treats `MCC` (no number) as no match, which is the safe outcome.

## 15.6 Operational facts used above (tests inspected and actual results)
Run in a worktree of the base SHA (`node --import ./tools/register.mjs db/test/<name>.mjs`), **[ran]**:
`custom-fields` 5/5 · `electrical` 21/21 · `doc-control` 9/9 · `asset` 6/6 · `area-coverage` 5/5 · `equipment` 25/25 · `engineering-validation` 34/34.
Inspected, **not** re-run here: `db/test/pid-intelligence.mjs` (27 tests at the base), `db/test/api.mjs`. The full `npm run db:test` / `db:test:pg` were **not** run for this documentation-only change (CI runs them). The `[probe]` of §15.1 is the only ad-hoc execution.

## 15.7 SLD connectivity and revision boundaries (not a copy of the P&ID rules)

**Reviewed:** the Phase 11 P&ID graph (`lib/pid/graph.mjs`) and PR #86 (Phase 11.1; **merged** 2026-11-07T17:22:19Z as `ec56976848032cfd5cd1404b18b25ee5a3c89e5d`; before merging it passed the 5 CI checks on head `71592ca` and local `db:test`, `db:test:pg` and browser drives, §16.1). #86 fixes two process-drawing defects: a directory match is not proof, and a line reference must match. Those corrections are *necessary but not sufficient* for an electrical network, because a piping connector joins two ends of **one fluid line** (a 1:1, undirected continuation with a unique line number), whereas an SLD connector may continue a **bus**, a **feeder**, or a **group of outgoings**, carries **direction** (supply/load), a **voltage level**, and joins elements whose connectivity depends on **switching state**. The SLD rules are therefore their own:

1. **Connector kinds** (`kind` attribute, closed set): `bus-continuation`, `feeder`, `incomer`, `outgoing-group`, `interlock/signal`. Reciprocity is judged *per kind*.
2. **Reciprocal reference:** the target sheet must hold exactly one connector that (a) names this sheet, (b) has the **same kind**, (c) the same normalised circuit/bus/feeder label (whitespace and case only), (d) the **opposite direction** where a direction is printed, and (e) the **same voltage level** where both print one. Missing/different on any printed field ⇒ not a match (never a fallback to "the other one"). Unprinted fields are *unknown*, not wildcards: an unprinted label makes the pair `unconfirmed`, not `resolved`.
3. **Duplicate connector labels are normal on an SLD** (the same continuation label "TO SWBD-2" repeated for several feeders; bus labels "A"/"B"). Duplicate labels therefore never imply identity: duplicates ⇒ `ambiguous` unless a second printed discriminator (way number, feeder tag, cable number) selects exactly one. Duplicate *equipment tags* remain an error (`S_TAG_DUP`).
4. **Statuses:** `resolved` (target's own draft available, exactly one compatible reciprocal), `unconfirmed` (target exists but not read, or no compatible reciprocal), `unresolved` (no such sheet), `ambiguous` (several). A resolved link does not add adjacency inside a draft; cross-sheet traversal is a query over *resolved* links only; an unconfirmed relationship is **never traversed** by any derived view (downstream loads, bus membership, feeder destination) and is shown distinctly.
5. **Voltage-level transitions:** a power edge may join two different voltage levels only through a transformer (or a declared converter/UPS class). A bus carries one voltage; an edge between buses printing different voltages with no transformer between them is `S_VOLTAGE_TRANSITION` (error — only when **both** voltages are printed); a connector pair whose printed voltages differ is `unconfirmed` plus an error finding. A missing voltage is *missing information*, never assumed from the neighbour.
6. **Switching state:** topology and energisation are different. A breaker/isolator/coupler drawn open (or marked normally-open) separates bus sections **topologically as "device in path"**, not as absent; the graph stores `via` devices and `state` as printed; no analysis may treat an unknown state as closed. Two bus sections are never merged by name.
7. **Multiple candidate destinations** of a feeder (two possible loads/buses within tolerance, a crossing with no junction dot): `ambiguous` with the candidate list; never the nearest. A feeder with none: `missing`.
8. **Revisions:** UIDs are born per draft and never copied; a revision comparison proposes mappings and a person confirms them one-to-one within the same class (stored on the target draft). Extra SLD rules: bus **sections** map to sections (a section renamed is `renumbered`, a section split/merged is `ambiguous`, never auto-mapped); a **device state change** (open↔closed, normally-open↔closed) and a **feeder moving to another bus section** are *high-impact changes* flagged for review; an approved draft is never changed; a changed tag is `renumbered` only through an explicit mapping.
9. **Unconfirmed relationships stay unconfirmed across revisions** — a confirmation made against revision A of the far sheet does not carry to revision B automatically.

## 15.8 Corrections to the Step-0 text found during this closure
* §1.2/§2: document intake **does** have `cable` and `structure` kinds (migration 066) and reads datasheet design conditions; Step 0 said the kind list had no `cable`. Corrected above; the conclusion (no `sld` kind, nothing reads an SLD) stands.
* §2 item 6 said the per-consumer audit was unverified; it is now done (§15.1) and shows the isolation gap is **wider than the review queue and already affects P&ID drafts**.
* §1.2 said asset master has no electrical ratings (true) — it did not say that `setAssetMaster` **refuses non-equipment tags** and overwrites the whole row; both matter for §15.4.

## 15.9 Required architecture decisions (summary)
| # | Decision | Alternatives | Selected | Reason | Unresolved risk |
|---|---|---|---|---|---|
| 1 | Extraction pass isolation | per-pass deny-lists · `pass_name IS NULL` allow-list · separate table/column/view (migration) | **Shared predicate on document type** + route guards + reserved pass names; `pass_name='sld'` | doc type is authoritative and set once; today's isometric data is byte-identical under it (differential test); no schema change | a future raw reader of `current_run` re-opens the gap (mitigated by a source-scan test); existing P&ID leaks (rows 3, 13, 15, 19) need the same fix |
| 2 | Document type & MDR | free text as today · type table (migration) | **Closed set `isometric|pid|sld`**, 400 on unknown, 409 on type conflict, no SLD table; MDR unchanged | meets "never silently isometric", reuses document identity/lineage/MDR (type-agnostic) | MDR `doc_type` label vs machine type are not linked; clients sending other strings will now get 400 (none found) |
| 3 | Electrical spec ownership | A draft-only · B extend `asset_master` · C separate register · Custom Fields | **A now; C when promotion is wanted; B and Custom Fields rejected** | no migration needed today; B collides with the equipment-only guard and whole-row overwrite; Custom Fields lacks units/source/history/approval | tag discipline for electrical equipment; multi-voltage model; unit list — owner/engineer decisions |
| 4 | Cable endpoint identity | A text + proposals · B `from_tag_id` · C endpoint table | **A now; C (not B) later if the register must carry ends** | B cannot represent ambiguity/unresolved; C is additive and keeps legacy text/`to_tag_id` | whether `from` should drive readiness |
| 5 | SLD draft persistence | `extraction_run` · new draft table | **`extraction_run`, `pass_name='sld'`, own modules/repo/routes** | pass-agnostic lock/approval triggers, `extraction_edit` audit, `approveRun`, document binding | payload size loaded by `joint.mjs:337` (performance) |
| 6 | Revision & approval boundaries | approval writes registers · approval is a reading only | **Approval = reading signed; promotion to registers is a separate, explicit, audited action** | keeps extracted ≠ authoritative; mirrors intake's applied/conflict-with-reason | promotion UI/scope deferred |
| 7 | Multi-sheet connectivity | reuse P&ID semantics · SLD-specific | **SLD-specific (§15.7)** | power networks differ (direction, voltage, state, duplicate labels, bus continuation) | rule set unvalidated on real sheets (no samples) |

## 15.10 Exact files Phase 12.2 must change
> **Corrected by §16.3:** the list below included the extraction engine and the topology graph, which belong to 12.3/12.4. §16.3 is the authoritative Phase 12.2 file list.

**New:** `lib/documents/types.mjs`; `lib/db/run-scope.mjs`; `lib/sld/{vocab,draft,graph,review,registers,compare}.mjs`; `lib/db/repos/sld.mjs`; `app/api/sld/route.js`, `app/api/sld/review/route.js`; `db/test/sld-intelligence.mjs`, `db/test/run-isolation.mjs` (differential + source-scan); `package.json` (`db:test` chain).
**Changed (guards, behaviour-preserving for isometric data):** `app/api/documents/route.js`; `lib/db/repos/documents.mjs`; `lib/db/repos/review.mjs` (queue, hotspots, `applyCorrection`); `lib/db/repos/runs.mjs` (reserved `passName`, `latestRunForDrawing`); `app/api/runs/route.js`, `app/api/runs/[id]/route.js`, `…/approve`, `…/diff`, `…/edits`, `…/ndt-sample`; `lib/db/repos/validation.mjs`; `lib/db/repos/log.mjs`; `lib/db/repos/piping-hub.mjs`; `lib/db/repos/piping-reports.mjs` (drawing-list query); `app/api/overview/route.js` (owner decision on semantics); `lib/db/repos/revision-lifecycle.mjs` (`carryForward` guard); `lib/db/repos/revisions.mjs`; `lib/platform/areas.mjs` (+ `/api/sld`), `lib/platform/tile-apis.mjs` (generated), `db/test/area-coverage.mjs`.
**Must NOT change:** `lib/engine.js`; isometric extraction (`app/api/extract`, `lib/sheet/*`, `parseSheet`); `lib/pid/*` (P&ID behaviour); `lib/electrical/cable.mjs` and cable import/IR behaviour; `db/migrations/*`.

## 15.11 Migration decision
**None for Phase 12.2.** The isolation, document-type and draft-persistence requirements are met by code and existing columns (`document.doc_type`, `extraction_run.pass_name`, `payload jsonb`, `parent_document_id`). Two later requirements may need an additive migration **only on the owner's decision**: the electrical attribute-fact register (§15.4 C) and the cable-end table (§15.5 C); each is independent, additive, RLS-protected, and run on production only by the owner.

## 15.12 Regression risks
1. Guards change shared queries: a mistake alters isometric figures → differential test (before/after byte-identical on isometric-only data; unchanged after adding `pid`/`sld` documents).
2. `INVALID_DOC_TYPE` could reject an unknown client → only the P&ID path sends `docType` today; log-and-monitor before enforcing is an alternative if the owner prefers.
3. `DOC_TYPE_CONFLICT` could block an existing mixed-type document number → a pre-check query over production data (read-only) before enabling.
4. Fixing the P&ID leaks changes visible numbers (piping hub drawing count, activity log, hotspots, overview) — intended, but must be communicated.
5. SLD payload size in `joint.mjs:337` (loads every current run payload) → bound or filter by type.
6. `extraction_edit` is shared: hotspots/analytics must filter by run pass.

## 15.13 Test requirements (Phase 12.2)
> **Corrected by §16.6:** the SLD pure/server suite of §10.3 is split between 12.3 and 12.4; §16.6 is authoritative for 12.2.

Differential isolation test (§15.1); document-type matrix (§15.2); run-id route guards (409 `NOT_AN_ISOMETRIC_RUN` on `/api/runs/[id]/*` for `pid`/`sld` runs); reserved `passName`; `validation` guard; source-scan test for unreviewed `current_run`/`extraction_run` readers; plus the pure/server SLD suite of §10.3. Existing suites that must stay green unchanged: `electrical`, `doc-control`, `asset`, `api`, `pid-intelligence`, `engineering-validation`, `area-coverage`, `custom-fields`, the isometric review/queue tests, `db:test:pg`, `eval:check`. Every guard proven by reverting the code it protects.

## 15.14 Phase 12.2 acceptance criteria
> **Corrected by §16.5:** items 5–6 below required the contract sanitizer and the connectivity rules; they belong to 12.3/12.4. §16.5 is authoritative.

1. `docType` is a closed set; unknown → 400 `INVALID_DOC_TYPE`; `sld` accepted; type conflicts → 409; `pid` and `isometric` behave exactly as before (existing tests unchanged).
2. No isometric consumer of §15.1 (rows marked L) returns or counts a `pid` or `sld` run, document or edit; isometric-only data yields identical output before/after (differential test); id-addressed isometric routes refuse non-isometric runs.
3. SLD drafts persist as `extraction_run` (`pass_name='sld'`) with idempotent ingest, stale-edit 409, locked after sign-off; SLD runs are absent from the isometric review queue, piping hub, reports, activity log, hotspots and overview figures.
4. An SLD sheet is filed through the existing document/MDR workflow (MDR entry, issue, transmittal, lineage via `createRevision`), with no SLD document table.
5. The contract of §5 (Facts: printed/extracted/calculated/unknown; UIDs; evidence; review statuses) is enforced by the sanitizer; a reader can only create `extracted` records.
6. The connectivity rules of §15.7 are implemented and tested (reciprocity by kind/label/direction/voltage, duplicate labels, unconfirmed never traversed, voltage-transition, switching state, multiple candidates, revision mapping boundaries).
7. No `tag`, `asset_master`, `cable`, `cable_activity`, `ir_test`, `subsystem` row is created or modified by any SLD action (row-count test before/after).
8. `lib/engine.js`, isometric extraction, P&ID behaviour, cable import/IR behaviour unchanged; no migration.
9. Final-SHA verification: `db:test`, `db:test:pg`, `eval:check`, `next build`, SLD + P&ID + isometric browser drives; **no accuracy claim** without real labeled SLD sheets (§10).

## 15.15 Master-plan correction
None required beyond Phase 12 Step 0's item-9 split. (The master plan does not describe the extraction-pass isolation or document-type handling audited here.)


---

# 16. Phase 12.1 — Closure review and scope correction

Documentation and audit correction only (no production code, migration, API, UI or SLD functionality). This section **supersedes** §12.3, §13, §15.10, §15.13 and §15.14 where they differ (each carries a pointer). The findings of §15 (the 25-consumer inventory, the decisions of §15.9) are preserved unchanged.

## 16.1 Synchronisation and the merged state of PR #86
* This branch was synchronised by **merging** `origin/master` (no rewrite of its history; no conflicts). Master observed: `ec56976848032cfd5cd1404b18b25ee5a3c89e5d`.
* **PR #86 (Phase 11.1, P&ID off-page connectivity integrity) is merged**: squash-merged 2026-11-07T17:22:19Z as `ec56976848032cfd5cd1404b18b25ee5a3c89e5d` (PR head `71592ca49d4918033e14aa4fdf35f8d84bce5e39`, base `fe7bd98`). Its implementation was not touched by this branch (the merge brought it in verbatim: `lib/pid/graph.mjs`, `components/PidPanel.jsx`, `db/test/pid-intelligence.mjs`, `eval/pid/*`, `tools/drive-pid.mjs`, `docs/audit/phase-11-pid-intelligence.md`).
* Consequence for Phase 12: the corrected P&ID off-page rules now exist on master; the SLD design still **does not reuse** them (§16.4).
* The §15.1 inventory and probe describe the base `f0e239b`. #86 changed `lib/pid/graph.mjs`, the P&ID panel, the P&ID eval and the P&ID test/drive only; it did not touch any consumer of §15.1, so the inventory conclusions are unchanged. **[inspected: the diff of #86 lists 9 files, none of them a §15.1 consumer]** — the isolation leaks (rows 3, 13, 15, 19) therefore still exist on master `ec56976`.

## 16.2 Phase roadmap (nothing below is implemented unless stated)
| Phase | Title | Status |
|---|---|---|
| 12.0 | Step 0 architecture audit (PR #87) | **merged** (docs) |
| 12.1 | Architecture closure (this PR #88) | draft, docs only |
| 12.2 | SLD document intake and isolated draft persistence | not started |
| 12.3 | SLD extraction engine | not started |
| 12.4 | Electrical topology and connectivity | not started |
| 12.5 | Electrical register and cable reconciliation | not started |
| 12.6 | Validation, revision comparison and SLD workspace | not started |
Each phase: own branch, own draft PR, the five CI checks, no merge without the owner's «مرج کن». No accuracy claim in any phase until a labeled real SLD dataset exists (§10).

## 16.3 Corrected Phase 12.2 — SLD Document Intake & Draft Persistence
**Scope only:** (a) the closed document-type set `isometric | pid | sld`; unknown → `400 INVALID_DOC_TYPE`; same document number/sheet under another type → `409 DOC_TYPE_CONFLICT`; (b) SLD documents registered through the **existing** document/MDR workflow (no SLD document table); (c) SLD drafts persisted in the **existing** `extraction_run` with `pass_name='sld'` as an **opaque, minimally-enveloped** payload (below); (d) isolation of SLD runs from every isometric workflow through the shared run-scope predicate; (e) isometric run-id routes protected against non-isometric runs; (f) stale-edit protection and approval locking; (g) preserved revision lineage (`parent_document_id`, `createRevision`, `supersedePrevious`); (h) no migration unless one is demonstrated unavoidable.
**Minimal envelope (the only contract 12.2 validates):** `{ kind:"sld", schema:1, meta:{drawingNo?,revision?,sheet?}, page?:{number,width,height}, items:[], edges:[], source:{kind,reader,hash,generatedAt} }` — `items`/`edges` are arrays carried **verbatim** (not interpreted), size-bounded; the `source.hash` gives idempotent ingest. 12.2 defines **no** symbol classes, Facts, graph or validation rules.
**Explicitly not in 12.2:** symbol recognition, equipment classification, `Fact`/class vocabulary enforcement, electrical graph, voltage-transition analysis, cross-sheet topology, feeder-to-load traversal, cable reconciliation, workspace UI, validation findings, revision comparison.
**Files (authoritative list):**
* New: `lib/documents/types.mjs`; `lib/db/run-scope.mjs`; `lib/sld/envelope.mjs` (envelope check only); `lib/db/repos/sld.mjs` (ingest idempotent, get, edit with `baseHash` → 409 `STALE_RUN`, approve → lock, list by document); `app/api/sld/route.js` (GET/POST ingest) and `app/api/sld/review/route.js` (edit/approve; **no** per-item review semantics); `db/test/sld-intake.mjs`, `db/test/run-isolation.mjs`; `package.json` (`db:test` chain).
* Changed (guards, behaviour-preserving for isometric data): `app/api/documents/route.js`; `lib/db/repos/documents.mjs`; `lib/db/repos/review.mjs` (queue, hotspots, `applyCorrection`); `lib/db/repos/runs.mjs` (reserved `passName`, `latestRunForDrawing`); `app/api/runs/route.js`, `app/api/runs/[id]/route.js`, `…/approve`, `…/diff`, `…/edits`, `…/ndt-sample`; `lib/db/repos/validation.mjs`; `lib/db/repos/log.mjs`; `lib/db/repos/piping-hub.mjs`; `lib/db/repos/piping-reports.mjs` (drawing-list query); `app/api/overview/route.js` (owner decision on semantics); `lib/db/repos/revision-lifecycle.mjs` (`carryForward` guard); `lib/db/repos/revisions.mjs`; `lib/platform/areas.mjs`; `lib/platform/tile-apis.mjs` (generated); `db/test/area-coverage.mjs`.
* Must not change: `lib/engine.js`; isometric extraction (`app/api/extract`, `lib/sheet/*`, `parseSheet`); `lib/pid/*`; `lib/electrical/cable.mjs`, cable import and IR behaviour; `db/migrations/*`; `lib/db/repos/handover.mjs` / `asset_master`.

## 16.4 Phase 12.3 — SLD Extraction Engine (future; not 12.2)
PDF page processing; text and tag extraction; electrical symbol detection; equipment classification; cable and feeder **reference** extraction; bounding boxes and source evidence; confidence and review states; human correction workflow; the SLD class vocabulary and `Fact` contract of §5; a **synthetic** evaluation framework (a regression harness, labelled synthetic in its names, output and PR). **No accuracy claim without a labeled real SLD dataset** (§10.2). Readers only create `extracted` records.
**Boundary:** 12.3 records *what the drawing shows* (items, attributes, evidence, stated references). It does **not** build or traverse the power network.

## 16.5 Phase 12.4 — Electrical Topology and Connectivity (future; not 12.2/12.3)
Source-to-load electrical graph; transformer and voltage-level transitions; busbar sections and bus continuation; incomer and outgoing feeders; breaker/isolator states; cross-sheet reciprocal references; ambiguous and unconfirmed connections; revision-aware topology comparison; electrical validation rules.
**The P&ID graph semantics are not reused.** #86 is merged and its rules (a directory match is not proof; the line reference must match; unconfirmed adds no adjacency) are *necessary but not sufficient* (§15.7: direction, voltage level, switching state, duplicate connector labels, bus continuation). Any rule borrowed from `lib/pid/graph.mjs` must be re-derived from the electrical domain and validated by an electrical engineer on real sheets before it is relied on; until then 12.4 stays at "unconfirmed".

Later phases: **12.5** electrical register (attribute-fact register keyed to `tag`, §15.4 C, only on the owner's decision) and cable reconciliation (SLD ↔ `cable_no`, endpoint proposals, §15.5); **12.6** the Validation Center rules, SLD revision comparison and the `/sld` workspace.

## 16.6 Corrected Phase 12.2 acceptance criteria
Phase 12.2 must prove that SLD documents and drafts **enter the platform safely and change nothing for existing workflows**:
1. `docType` is the closed set; unknown → `400 INVALID_DOC_TYPE` (nothing registered); absent → `isometric` as today; same number/sheet under another type → `409 DOC_TYPE_CONFLICT`; `pid` and `isometric` unchanged (existing tests unchanged).
2. An SLD sheet is a `document` (`doc_type='sld'`) filed through the existing document/MDR workflow (MDR entry, issue, transmittal, revision lineage via `createRevision`, `supersedePrevious`); no SLD document table.
3. SLD drafts are `extraction_run` rows with `pass_name='sld'`; ingest is idempotent by `source.hash`; a stale edit (`baseHash`) → 409; after approval the run is locked (DB trigger + application) and a different reading is refused (`RUN_LOCKED`); approval records approver, time and hash and **promotes nothing**.
4. **Isolation:** every row marked L in §15.1 is guarded; the **differential test** (§16.7) passes; id-addressed isometric routes reject non-isometric runs; no isometric screen, report, log, counter or analytic returns or counts a `pid` or `sld` run, document or edit.
5. No `tag`, `asset_master`, `cable`, `cable_activity`, `ir_test` or `subsystem` row is created or modified by any 12.2 path (row-count test before/after).
6. `lib/engine.js`, isometric extraction, P&ID behaviour and the cable import/IR workflow are unchanged; no migration; no UI.
7. Final-SHA verification: `db:test`, `db:test:pg`, `eval:check`, `next build`, P&ID and isometric browser regressions — reported only for the exact SHA that completed them.
**Not criteria of 12.2:** electrical symbol extraction, electrical graph, voltage-transition analysis, cross-sheet electrical topology, feeder-to-load traversal.

## 16.7 Test requirements (Phase 12.2)
**Differential isolation test (`db/test/run-isolation.mjs`), mandatory:**
1. Build an **isometric-only** project (documents, runs, welds/spools, edits, approval) and capture the output of every guarded function/route — `reviewQueue`, `hotspots`, `pipingHub`, `pipingReport` (all kinds), activity log (`sectionLog`), overview counters, `validationFor`, revision/lineage/compare routes, id-addressed run routes, `reporting.current_run` rows — serialised canonically.
2. Apply the shared scope guard (the change under test).
3. Re-capture: the outputs are **byte-identical**.
4. Add a `pid` document and an `sld` document, each with extracted and approved runs and extraction edits.
5. Re-capture: the isometric outputs are **still byte-identical** (piping outputs unchanged).
6. Call every isometric id-addressed route (`/api/runs/[id]` and `approve`, `diff`, `edits`, `ndt-sample`; `compareRuns`; `carryForward`; `applyCorrection`; `validationFor`; `/api/runs` POST with a non-isometric `documentId`/reserved `passName`) with the `pid`/`sld` run or document id: each is rejected (`409 NOT_AN_ISOMETRIC_RUN` or the route's equivalent), nothing written.
**Source-scan test (mandatory):** fails when a source file outside a reviewed allow-list reads `reporting.current_run` or `FROM extraction_run` / `JOIN extraction_run` (and `extraction_edit` aggregates) — so a future unreviewed reader cannot reopen the leak.
**Document-type matrix:** §15.2 cases (1)–(9). **SLD persistence:** idempotent ingest, stale 409, lock after approval (the DB trigger is hit directly too), authorization (viewer refused, other project sees nothing), concurrency of two ingests, envelope size/shape refusal. **Guard proofs:** every guard demonstrated by reverting it and watching a test fail. **Existing suites that must stay green unchanged:** `pid-intelligence`, `electrical`, `doc-control`, `asset`, `api`, `engineering-validation`, `area-coverage`, `custom-fields`, the isometric review/queue tests, `db:test:pg`, `eval:check`.

## 16.8 Decisions that stay explicit (unchanged by this correction)
* Electrical ratings stay **in the SLD draft** initially; `asset_master` is **not** extended in 12.2; Custom Fields are **not** authoritative engineering specifications.
* Cable endpoint identity stays **text plus link proposals**; an uncertain cable endpoint is **never** attached to a tag automatically; `to_tag_id` semantics are unchanged; cable import and IR workflows are not modified.
* No separate SLD draft table and no separate SLD document table; no migration in 12.2.
* Approval of an SLD draft is **not** promotion to any authoritative register.

## 16.9 Verification statements — what was and was not executed
| Category | What | Result |
|---|---|---|
| **Executed on the audit base SHA `f0e239b`** (worktree, `node --import ./tools/register.mjs db/test/<name>.mjs`) | `custom-fields`, `electrical`, `doc-control`, `asset`, `area-coverage`, `equipment`, `engineering-validation` | 5/5 · 21/21 · 9/9 · 6/6 · 5/5 · 25/25 · 34/34 |
| **Scratch database probe** (throwaway PGlite on `f0e239b`, script not committed) | a P&ID document ingested, corrected, set `approved` | `hotspots.totalEdits = 1`; `current_run` 1 row; `pipingHub.drawings = 1`, `drawingsApproved = 1`; activity log shows it as a weld-register approval; overview counts 1 approved document; weld-log report and review queue did not list it |
| **Inspected, not executed** | `db/test/pid-intelligence.mjs` at the base (27 tests), `db/test/api.mjs`, every SQL of §15.1, the diff of #86 | no result claimed |
| **Not executed for this PR** | full `npm run db:test`, `db:test:pg`, `eval:check`, `next build`, browser drives (documentation-only change; CI runs the first four) | none claimed |
| **CI on this PR's head** | recorded in the PR (see below) | see below |
| **Vercel** | "Vercel Preview Comments" is a deployment/preview check. **It is not evidence that any database or unit test passed**; only the `data-layer` (`db:test`), `pg-scope` (`db:test:pg`), `eval` and `build` jobs of the workflow are. |
| **Master `ec56976`** | the workflow run for the merge commit is a separate run from #86's PR run; at the time of writing (17:2x UTC) its `build`, `pg-scope` and `eval` jobs had completed successfully and `data-layer` was still running. **No claim is made that master `ec56976` has passed `db:test`** until that exact run completes. |
(The Phase 11.1 results quoted in `docs/audit/phase-11-pid-intelligence.md` §16 are of head `71592ca`, run locally and by the PR's CI — not of the merge commit.)

## 16.10 Remaining risks and unverified items
1. The isolation guards touch shared isometric queries: a mistake alters isometric figures — hence the differential test and the source-scan test.
2. The §15.1 inventory is by reading; row 16 (the `piping-reports.mjs:30–36` drawing list) exposure is **unverified** (the weld-log report did not list the P&ID in the probe).
3. `INVALID_DOC_TYPE` could reject an unknown client — only the P&ID path sends `docType` today (inspected in `app components lib`; `tools/drive-pid.mjs` sends `pid`); a production data check (read-only) before enforcing is recommended.
4. `DOC_TYPE_CONFLICT` could block an existing mixed-type document number — read-only pre-check on production data needed.
5. Existing P&ID leaks (activity log label, hub counts, hotspots, overview) are on master now; 12.2's guards will change those visible numbers (intended) — to be communicated.
6. `lib/db/repos/joint.mjs:337` loads every current run's payload; large SLD payloads would add cost — bound or filter by type.
7. Open owner decisions: tag discipline of electrical equipment; multi-voltage model; unit canonical list; whether `from` should ever drive readiness; the `overview` approved-document semantics.
8. No labeled real SLD dataset: recognition accuracy is unmeasurable (§10).

---

# 17. Phase 12.2 — implementation record (SLD document intake and isolated draft persistence)

Base: `master` @ `a9b5459f5c761472ce7b276204b6bfd46d8fcc1f` (PR #88 merged). Implementation SHA tested: **`20aad9a6665ae151606b0ecb0524c53837f3f73d`**. This section is the only change of the commit that follows it (documentation only; `git diff 20aad9a..HEAD` lists this file alone). No migration; no UI; nothing of §16.3's exclusions was implemented.

## 17.1 What was built
* **Document types** — `lib/documents/types.mjs`: closed set `isometric|pid|sld`; absent/`null`/blank → `isometric` (unchanged); case-normalised; anything else → `400 INVALID_DOC_TYPE` with the allowed list, **before any byte is stored** (`app/api/documents/route.js`). `registerDocument` (`lib/db/repos/documents.mjs`): the same number and sheet already on file under another type → `409 DOC_TYPE_CONFLICT`.
* **Run scope** — `lib/db/run-scope.mjs`: `isIsometricDoc(alias)` (SQL fragment on `document.doc_type`), `assertIsometricRun`, `assertIsometricDocument` (`allowMissing` keeps each routine's old answer for an unknown id), reserved pass names `pid`/`sld`.
* **SLD drafts** — `lib/sld/envelope.mjs` (shape and size only), `lib/db/repos/sld.mjs`, `app/api/sld/route.js` (list / read / ingest), `app/api/sld/review/route.js` (edit with `baseHash`, approve); `/api/sld` is in area `electrical` (`lib/platform/areas.mjs`). Drafts are `extraction_run` rows with `pass_name='sld'`.
* **Tests** — `db/test/sld-intake.mjs` (20), `db/test/run-isolation.mjs` (8), both in the `db:test` chain; drive `tools/drive-sld-intake.mjs`.

## 17.2 Guards (every row marked L in §15.1)
| Inventory row | Guard |
|---|---|
| 1 review queue | `isIsometricDoc("d")` replaces the `pid` deny-list |
| 2 `applyCorrection` (`/api/runs/[id]/edits`) | `assertIsometricRun` |
| 3 `hotspots` | joins run → document, isometric only |
| 5 `createRun` / `POST /api/runs` | reserved `passName` refused (`400 INVALID_PASS_NAME`); document must be isometric (`409 NOT_AN_ISOMETRIC_DOCUMENT`) |
| 7 `latestRunForDrawing` | isometric documents only |
| 8 `validationFor`, `/api/validation` (both branches) | `assertIsometricDocument` |
| 9 `GET /api/runs?documentId` | `assertIsometricDocument` |
| 10 `/api/runs/[id]` GET, `approve`, `diff`, `edits` GET/POST, `ndt-sample` | `assertIsometricRun` (`409 NOT_AN_ISOMETRIC_RUN`); `diff` through `compareRuns` / `compareWithPrevious` |
| 11 `compareRevisions`, `carryForward` | `isometricOnly` (`409 NOT_AN_ISOMETRIC_DOCUMENT`); `lineageOf`/`createRevision` stay type-agnostic |
| 12 `revisions.mjs` | guard in `loadRun` / `compareWithPrevious` |
| 13 activity log | isometric documents only |
| 15 piping hub | isometric documents only |
| 16 `piping-reports.mjs` drawing list (used by the bom / ndt / progress reports) | isometric documents only |
| 17 `joint.mjs` tie-in scan | isometric documents only (defence in depth; the output was already equal) |
| 19 overview card (weld registers) | isometric documents only |
Rows 4, 6, 14, 18, 20–23 are safe by construction (document-scoped, shared on purpose, or reached only through spool/weld rows) and are listed in the source-scan test.

## 17.3 Decisions made while implementing
* The route guards are in the **routes** where the repository function is shared with the other disciplines (`approveRun` is reused by the P&ID repo, so it is not guarded; the approve **route** is).
* Unknown ids keep their old answers (`allowMissing`): `POST /api/runs`, `GET /api/runs`, `/api/validation` still answer as before for a document that does not exist; only an existing non-isometric drawing is refused.
* `baseHash` is **required** on an SLD edit (no silent last-write-wins). An edit replaces the envelope; it writes one `extraction_edit` row (`path '/'`, hash and counts before/after); an identical envelope (compared with sorted keys, because `jsonb` reorders) changes nothing.
* The server stamps `meta.document` (`documentId`, `docNo`, `revision`, `sheetNo`) on every draft, whatever the client sent; each revision is its own document and therefore its own draft — nothing, including approval, is copied from an earlier revision (test R1).
* Size limits: 2,000,000 bytes, 20,000 items, 50,000 edges, 100 meta keys; the request body is refused (`413`) before it is parsed when it exceeds 1.5× the limit.
* The overview "documents" card is the weld-register tile (its text is "N approved registers"); it now counts isometric documents only. Owner decision recorded in §16.10 item 7 stays open for any wider meaning.

## 17.4 Proofs
* **Differential isolation (`db/test/run-isolation.mjs`)**: on an isometric-only project, every guarded function and route output (review queue, hotspots, piping hub totals, all four piping reports, activity log, tie-in, validation, overview, run/edits/diff/validation routes) equals the figure of the **original, unguarded SQL kept verbatim in the test** (A1); after adding a P&ID and an SLD (documents, runs, extraction edits, a signed draft each) the canonical outputs are byte-identical to the isometric-only capture (B1) while the unguarded reference figures *do* move (hotspots, hub, log, overview, drawing list) — the leak is demonstrated and is what the guards stop. C1–C4: every run-id and document-id route refuses the other disciplines' run/document (`NOT_AN_ISOMETRIC_RUN` / `NOT_AN_ISOMETRIC_DOCUMENT`), nothing is written, authorization (403) and project scope (404) are intact, and the isometric workflow still works (a signed isometric register is still `RUN_LOCKED`). D1–D2: the source scan fails on an unreviewed reader of `reporting.current_run` / `extraction_run` / `extraction_edit`, and on a "guarded" file that does not import the run-scope module.
* **Not a cross-version diff:** the differential compares guarded code with **verbatim copies of the pre-change SQL inside the test**, not with the previous commit's binary output. A reviewer who wants the stronger check can run the same capture on `a9b5459` and on this branch and compare after masking ids and timestamps; that was not done here.
* **Guard-reversion proofs** — each guard was removed in turn (the file restored after each run) and the named test failed: review queue → run-isolation B1; hotspots B1; `applyCorrection` C1; piping hub B1; activity log B1; overview B1; report drawing list B1; approve / run GET / edits GET / ndt-sample / compare route guards C1; `POST /api/runs` document guard C2; reserved pass name C2; validation route guard (spool branch; main branch with the repository guard) C2; `carryForward` guard C2; unknown type → isometric again: D1, D2; `DOC_TYPE_CONFLICT` removed: D3; SLD edit after approval unlocked: S7; stale check removed: S5, S6, S8; non-idempotent ingest: S2, S4, S7; SLD document type not required: S3. **One exception, stated:** the `joint.mjs` tie-in filter is behaviourally equivalent (its output did not change), so removing only that filter is not caught by an output test; the source scan (D2) catches removal of its import.
* **Database lock**: S8 attempts a direct `UPDATE` of an approved SLD run's payload and the existing trigger `refuse_locked_edit` refuses it.

## 17.5 Verification on the implementation SHA `20aad9a6665ae151606b0ecb0524c53837f3f73d`
| Check | Result |
|---|---|
| `npm run db:test` | 127 suites, 1705 passes, **0 FAIL** (includes `sld-intake` 20/20 and `run-isolation` 8/8) |
| `npm run db:test:pg` (local PostgreSQL 16) | 8/8, 15/15, 5/5, 3/3 |
| `npm run eval:check` | GATE PASSED |
| `npx next build` | passed |
| P&ID drive (`tools/drive-pid.mjs`, fresh database) | 21 true, 0 false, no page errors |
| Isometric drive (`tools/drive-equipment-spool.mjs`) | 26 true, 0 false, no page errors |
| SLD intake drive (`tools/drive-sld-intake.mjs`) | 15 of 15 true, no page errors |
| Differential isolation test | part of `db:test` (`run-isolation`, 8/8) |
Notes: an earlier `db:test` run on `4cfc548` (the same code without the drive script) failed only in the migration 102/103 suite because the disk was full while that suite held ten database copies; the rerun on a disk with space passed. The drive script is the only difference between `4cfc548` and `20aad9a`. CI results of the PR are recorded in the PR, not here; Vercel's check is a preview deployment and is not evidence of database tests.

## 17.6 Remaining risks and unverified items
1. The L-row list was derived by reading the code; the source-scan test only catches a *new* reader, not a mis-classified existing one. `bom-allocations`, `iso-equipment` and `mark-identity` routes are document-addressed isometric routes that would still accept an SLD document id for sheet-mark data (not part of the §15.1 inventory; to be reviewed).
2. `INVALID_DOC_TYPE` / `DOC_TYPE_CONFLICT` can reject a client or a production document number that mixes types — a read-only check of production data is recommended before deployment.
3. The visible figures of the piping hub, activity log, hotspots and overview change **only** where a P&ID/SLD was previously (wrongly) included; for isometric-only projects they are identical.
4. No real SLD sample exists: nothing here measures recognition, and nothing interprets `items`/`edges`.
5. Approval signs the draft envelope; it promotes nothing (row counts of tag, asset, cable, IR and other registers are unchanged: test S9).

---

# 18. Phase 12.2.1 — Isometric Document Boundary Hardening

Closes the first risk of §17.6: `bom-allocations`, `iso-equipment` and the mark-identity warning routes were addressed by a document id (or a child id) and would accept an SLD / P&ID document. No migration, no schema change, no change to `lib/engine.js`, extraction, geometry, `lib/pid/*`, SLD extraction or any UI.

## 18.1 Inspection (not assumed from the audit inventory)
Every `app/api/**/route.js` that takes `documentId`, `accessoryId`, `allocationId`, `warningId` or a mark identity, and every file touching `bom_allocation*`, `iso_equipment*`, `sheet_mark_*`, `iso_bom_row`, was read.

| Route / file | Verdict |
|---|---|
| `app/api/bom-allocations` GET, POST | **isometric-only → guarded** |
| `app/api/iso-equipment` GET, POST | **isometric-only → guarded** |
| `app/api/mark-warnings` GET, POST | **isometric-only → guarded** |
| `app/api/validation`, `app/api/overview`, `app/api/runs`, `app/api/runs/[id]` | guarded in 12.2 |
| `app/api/documents`, `app/api/revisions` (lineage / link / create) | type-agnostic by design (a document, its file and its lineage belong to any discipline) |
| `app/api/pid`, `app/api/sld` | own discipline, own pass |
| `registry-check`, `piping/reports`, `changes`, `extract`, `read-local` | doc-number keyed, generic or weld based; touch none of the isometric-only ledgers |
| `lib/db/repos/line-list.mjs`, `register-persistence.mjs`, `revision-lifecycle.mjs`, `lib/engineering/validation.mjs`, `lib/sheet/weld-list-identity.mjs` | only reached from the guarded flows above (`/api/runs`, guarded routes); listed in the source scan as `reachedOnlyViaGuarded` |
| `lib/db/repos/spine.mjs` `fileDocument` | generic subsystem filing; writes none of the isometric-only tables |

## 18.2 Routes protected, and how
All use `lib/db/run-scope.mjs`; the document type is always read from the database inside the project scope, never from the client.

* `GET /api/bom-allocations` (availability, `history=1`) and `POST` (install / return / release) — `assertIsometricDocument` (and in the POST transaction `assertIsometricAllocation`).
* `GET /api/iso-equipment` (list) and `POST` (accessory status) — `assertIsometricDocument` / `assertIsometricAccessory`.
* `GET /api/mark-warnings` (list) and `POST` (resolve) — `assertIsometricDocument` / `assertIsometricWarning` inside the transaction.
* Repo level (the same functions are what any future caller would use): `bom-allocation.mjs` `syncAllocations`, `verifyLedger`, `availability`, `history`, `transition`; `iso-equipment.mjs` `syncEquipment`, `listEquipment`, `setAccessoryStatus`; `mark-identity.mjs` `reconcileSheetMarks`, `registerMarks`, `recordMarkWarnings`, `recordEquipmentWeldWarnings`, `markWarnings`, `resolveMarkWarning`; `validation.mjs` `warningsFor`, `resolveWarning`.

**Child-id ownership checks (new in `run-scope.mjs`):** `assertIsometricAccessory` (accessory → equipment → document), `assertIsometricWarning` (warning → document), `assertIsometricAllocation` (allocation → document). Each resolves the owning document from the database in the project scope and refuses with `409 NOT_AN_ISOMETRIC_DOCUMENT` only when the record EXISTS and its document is not an isometric. A record that does not exist, or belongs to another project, keeps the previous answer (404). An accessory status change checks ownership BEFORE the `UPDATE`.

Errors: SLD / P&ID → `409 NOT_AN_ISOMETRIC_DOCUMENT` (`details.docType`); unknown or cross-project ids → the existing 404 (or the existing empty answer of a GET); authorization, project scope and transaction boundaries are unchanged.

## 18.3 Tests (`db/test/iso-boundary.mjs`, in the `db:test` chain after `run-isolation`)
18 tests: setup (one project, isometric + isometric + P&ID + SLD documents, each with BOM, ledger line, event, equipment, accessory, warning, identity); A1–A4 isometric operations unchanged (route and repo level); B (SLD, P&ID) every protected route GET + POST → 409, and 16 repo functions inside a transaction → 409, with the byte-identical state of all seven isometric-only tables before and after (no row, no history event); C1 an SLD / P&ID allocation / accessory / warning is refused even under an isometric document id (route and repo), C2 an isometric child under another isometric document id keeps the old 404; D1 unknown ids, D2 cross-project ids, D3 non-member authorization (type never disclosed); E1–E4 source scans (every route taking a document / child id is reviewed and a guarded one imports `run-scope.mjs`; every file touching an isometric-only table is reviewed; every exported repo function taking a document / child id calls a guard).

Guard-reversion proofs (guard removed, test fails, file restored): route child-id guards (allocation, accessory, warning), the repo-level document guards of all four repos, and the route-level calls (E2). Removing only the route-level `assertIsometricDocument(tx…)` of `bom-allocations` POST does NOT change behaviour because the repo functions it calls carry the same guard (defence in depth, by design).

## 18.4 Verification on the final implementation SHA
See the PR description (filled with the exact results; anything not run is marked NOT RUN there).

## 18.5 Is the §17.6 risk fully closed?
**Yes for every discovered document-addressed isometric-only route and repo function** (table 18.1). Remaining, deliberately unchanged:
1. `documents`, `revisions` (lineage / link / create) stay type-agnostic: they register, version and file any discipline's document.
2. `compareRevisions` / `carryForward` were already isometric-only (12.2).
3. The scan guarantees every NEW route that takes a document / child id, and every NEW file touching the isometric-only tables, is reviewed; it cannot judge whether a reviewer classified correctly.
4. An existing legacy production document whose `doc_type` is wrongly `isometric` (the column default) is still treated as an isometric: a read-only check of production data remains recommended.
