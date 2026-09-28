# EPC AI PROJECT MASTER CONTEXT

```yaml
status: CANONICAL
as_of: 2026-09-28
repo: moradisadegh1991-lab/iso-weld-map-source
branch: claude/vigilant-brown-wnaksu      # draft PR #1, not merged
head_at_writing: 404c4ed
language: Persian UI (RTL) / English identifiers; answer the owner in Persian
supersedes: EPC_AI_MASTER_CONTEXT_1.md (owner-supplied concept doc) — where the two
  conflict, THIS file describes what is built; the concept doc is kept as vision only
update_rule: change this file only when an architecture/data decision changes;
  per-session detail goes to SESSION_HANDOFF.md
```

Legend: **[FINAL]** decided and built · **[OBSOLETE]** proposed earlier, not the
built path · **[UNCONFIRMED]** stated somewhere, not verified in code/data ·
**[OPEN]** undecided · **[ASSUMPTION]** working assumption, not a fact ·
**[NOT BUILT]** agreed direction, no code yet.

Read order for a new session: this file → `SESSION_HANDOFF.md` →
`.claude/skills/epc-platform/SKILL.md` (binding working rules) → only the module
files the task touches.

---

## 1. Project Objective

- [FINAL] A Digital EPC platform: one database and one identity spine (`tag` →
  `subsystem`) carrying every discipline from document receipt through
  construction, QA/QC, completions, commissioning and handover to CMMS.
- [FINAL] Thread: Document/Drawing → Extraction (model) → Register (deterministic
  engine) → Human approval (hash-locked) → Execution records → Completions → Asset
  Master → CMMS export / reporting.
- [FINAL] Governing split: **the model extracts raw data; a deterministic engine
  decides; a human signs.**
- [FINAL] Master-plan order: data first, then automation, then analytics, then AI.
- Origin: isometric → weld-map/weld-register tool (repo name), since grown into the
  multi-discipline platform.

## 2. Business Problem

- Disconnected tools per department ("ten tools that never join"), each with its
  own tag list (master-plan risk 01).
- Values re-typed across screens → inconsistency. Rule: **one entry, many outputs.**
- Sign-offs (MC, RFC, RFSU, NCR closure, test acceptance) given while
  prerequisites are open. Rule: sign-off steps are refused while anything they
  certify is open.
- Guessed spec values (curing period, tolerances, NDT %) → false assurance. Rule:
  **UNKNOWN, never a guess**; missing facts go to the missing-information register.
- Contractor payment not tied to measured/verified progress → fixed by statements
  on WBS + PDMS + platform metrics (§8, §12).

## 3. Target Users

Roles (`lib/authz.mjs` `ROLES`) — [FINAL]:

| role | what it does | key actions |
|---|---|---|
| `viewer` | reads, comments | `project:view`, `log:comment` |
| `engineer` | extraction, approval, permits, MC, controls, procurement, doc control, statement verify | `register:approve`, `completions:mc`, `statements:verify`, … |
| `qc` | site records: welds, NDT, welders, HSE, quality, completions, inspection; prepares statements | `ndt:record`, `quality:record`, `statements:prepare` |
| `admin` | all actions | `Object.values(ACTIONS)` |
| `designer` | designer portal only (no project view) | `documents:design` |
| `contracts` | contracts, statement prepare + final approve | `contracts:manage`, `statements:prepare`, `statements:approve` |
| `finance` | payments | `finance:manage` |
| `hr` | personnel, timesheets | `hr:manage` |
| `developer` (platform flag, not a project role) | all actions | — |

- `can(membership, action)` takes a membership **object** `{role}`; a string
  silently denies everything.
- Areas (`lib/platform/areas.mjs`, `AREAS` + `API_AREAS`): a member's discipline
  scope limits menu and writes (added: `contracts`, `finance`, `hr`).
- Inspection party per member (EPC / contractor / client) for ITP hold/witness.
- Scenario persons: pm (engineer/admin), qc, client (inspection party), designer.
- Owner profile: maintenance/data engineer, petrochemical (Asalouyeh). Dashboard
  audience: operations managers, maintenance supervisors.

## 4. Functional Requirements

Built — [FINAL] (each with migration, repo, API, page, `db/test/*`, browser drive):

- **Piping**: isometric intake (PDF upload / no-file / manual or Excel weld list),
  extraction, engine register, review/diff, approve (hash lock), revisions,
  spools, execution chain (fabrication → fit-up → weld → NDT → erection →
  supports → test), welders/WPS/qualification, NDT selection with B31.3
  progressive sampling, inch-dia, weld log, Joint History, hub dashboard.
- **Civil** (ACI 318 concrete acceptance; pours, specimens), **Structural**
  (erection tolerance, bolt pretension), **Electrical** (cable schedule, IR test
  engine), **Instrumentation** (ISA 5.1 index, calibration, loop check),
  **Coating/insulation** (ISO 19840 DFT, dew point), **Equipment** (list import,
  manual tag entry, vendor register).
- **Spine**: unit, subsystem, tag, `tag_activity`, precedence chains
  (`lib/platform/precedence.mjs`), derived steps that refuse a hand tick.
- **Assumption register** (revisions, Proposed → Approved/Rejected/Superseded) and
  **missing-information register** (UNKNOWN with owner discipline + what it blocks).
- **Warehouse**: receipt vs PO, MIR/MTC, heat traceability, issue, reservation,
  stocktake, MESC catalogue.
- **Procurement**: MR (revisions, lines) → tender/bids → award → PO → expediting →
  FAT → shipment → site receipt; VDRL; Vendor Data Template.
- **Document control**: register, revisions, transmittals in/out, IDC, CRS
  comments, designer portal, files on storage with SHA-256.
- **Inspection**: ITP, inspection requests, hold/witness gating chain steps,
  material receipt ITP by category.
- **HSE**: incidents (IOGP classes), man-hours, LTIF/TRIR, permits + gas test,
  competence cards, scaffold/crane inspection, JSA — all gate permit issue.
- **Quality**: Punch A/B/C (+photo), NCR with escalation, concessions.
- **Completions**: test packs, MC certificate per subsystem, pre-commissioning
  checklists, RFC, commissioning procedures, RFSU, performance tests vs contract
  guarantees.
- **Controls**: control accounts (WBS), baselines, EV from platform progress, EVM,
  monthly `ev_snapshot`, risk register, `cost_entry`.
- **Handover/CMMS**: ISO 14224 asset master, FLOC, design conditions (only with a
  datasheet revision reference), DCS/Historian tags, PM plan, SPIR, periodic
  calibration, export.
- **Field**: QR labels, in-app scanner, offline PWA field pack + idempotent sync.
- **Contracts** (2026-09-28): contract/subcontract register, BOQ lines on WBS,
  PDMS design quantities import, payment statements (صورت وضعیت) with four-eyes
  workflow; **Finance** board and payments; **HR** personnel + timesheets;
  **per-section log** («لاگ و گردش») with workflow steps, signers, comments.
- **Removal policy** (`lib/db/repos/removal.mjs`): records (signed tests, issued
  permits, revisions, receipts) are never deleted; only mis-entered register rows
  with zero references (catalog-counted `USED_IN`).
- **Dates**: «روز پروژه» (project day N from `project.start_date`) beside every
  work date; no future pours; derived test dates.

## 5. Technical Architecture

[FINAL] — as built:

```
Browser (Next.js App Router, React, RTL, PWA/offline field pack)
   │  fetch /api/* (JSON)   cookie session
   ▼
Next.js route handlers  app/api/**/route.js   (Node runtime)
   │  authenticate() → membership → can()/assertCan()  (lib/server/session.mjs, lib/authz.mjs)
   ▼
Repos  lib/db/repos/*.mjs  ── deterministic engines lib/<discipline>/*.mjs, lib/engine.js
   │  withProject(db, projectId)  → SET app.project_id → RLS
   ▼
PostgreSQL  (PGlite embedded by default; DATABASE_URL → server Postgres)
   │                         Content store lib/storage (local | s3/MinIO)
LLM layer lib/llm (anthropic | openai-compatible/vLLM) — only called by /api/extract
```

- Runtime: Node, Next.js 15.5 (App Router), React; JS/ESM (`.mjs`), no TypeScript.
- DB: `@electric-sql/pglite` (dev/test/single-node) or `pg` with `DATABASE_URL`;
  migrations in `db/migrations/NNN_*.sql`, `DB_AUTO_MIGRATE`.
- Storage: `STORAGE_DRIVER=local` (`STORAGE_ROOT`, default `.storage`) or `s3`
  (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_REGION`, `S3_PUBLIC_ENDPOINT`); content-addressed by SHA-256; misconfigured
  S3 = error, never a silent local fallback. `deploy/minio/`, `npm run storage`.
- LLM: `LLM_PROVIDER=anthropic` (default; `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
  `ANTHROPIC_REPAIR_MODEL`, `ANTHROPIC_BASE_URL`) or `openai-compatible`
  (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_REPAIR_MODEL`, `LLM_MODELS`,
  `LLM_JSON_MODE`). Nothing above `lib/llm/` names a vendor.
- Auth: password + cookie session, login throttling (`LOGIN_SOURCE_MAX_FAILURES`),
  session revocation, one-time setup links; `AUTH_MODE`, `OIDC_ISSUER` seam for
  Keycloak/SSO [NOT BUILT: no identity server connected].
- CI: `.github/workflows/eval.yml` (jobs `eval`, `data-layer`).
- Docs for ops: `docs/DEPLOY.md`, `docs/RUNBOOK.md`, `docs/TERMUX.md`.

Concept-doc architecture vs built — decisions:

| concept doc (EPC_AI_MASTER_CONTEXT_1) | status |
|---|---|
| FastAPI backend | [OBSOLETE] for the core; REST is `app/api/*` in Next.js. Python allowed later as a **separate service** beside the same DB (drawing vision/OCR, ML) [NOT BUILT] |
| React/PWA | [FINAL] via Next.js; PWA offline field pack built |
| PostgreSQL | [FINAL] (PGlite or server Postgres), RLS per project |
| MinIO | [FINAL] optional driver `s3` |
| n8n | [NOT BUILT] [OPEN]; may call `app/api/*` via HTTP; domain logic must stay in the app |
| Qdrant / pgvector | [NOT BUILT] [OPEN]; RAG only with "no source → no answer" |
| Power BI / Grafana | Power BI notes in `docs/powerbi/README.md`; reporting views exist (`006_reporting.sql`); Grafana [NOT BUILT] |
| monorepo apps/packages/services | [OBSOLETE]; single Next.js app (layout §15) |
| queue technology | [OPEN]; none used |

## 6. Data Architecture

- [FINAL] One project = one `project` row; every project table has `project_id`,
  **RLS ENABLE + FORCE** keyed on `current_project_id()` =
  `current_setting('app.project_id')`; repos run inside `withProject()`.
- [FINAL] Spine: `unit` → `subsystem` (`system_code`, `code`, `handover_seq`,
  `target_mc_date`) → `tag` (`tag_no`, `discipline`, `kind`). Every discipline item
  references the spine **by id**, never by a copied tag string.
- [FINAL] Identity keys: `uuid` PKs; business keys unique per project
  (`UNIQUE(project_id, …)`).
- [FINAL] Approved registers are immutable: `extraction_run.approved_sha256`;
  correction = new revision (`superseded`), never an edit.
- [FINAL] Append-only history tables (DB-enforced where stated): revisions
  (`*_revision`), `ncr_event`, `punch_event`, `material_movement`,
  `contract_payment`, `workflow_event` (REVOKE UPDATE/DELETE from `app_rw`).
- [FINAL] Derived, not typed: steps the data answers (welds, pours, surveys, IR
  tests, calibrations, coatings, pressure tests from accepted packs) refuse a hand
  tick.
- [FINAL] Value labelling: verified data / engineering input / calculated /
  AI-generated / user-provided / pending validation must not be conflated.
- [FINAL] Large files never in PostgreSQL; `document.file_sha256` +
  `storage_uri`; `NO_FILE_URI = "none://no-file"` for registers saved without a
  drawing (digest = sha256("no-file\n docNo\n rev\n sheet")); a real file later
  attaches to the same row; "no file" never replaces a file.
- [FINAL] Log = `workflow_event` (new modules + all comments) UNION signatures
  **derived** from existing `*_by/*_at` columns (no copying).
- [FINAL] Cost truth: approved statement posts period gross per WBS into
  `cost_entry` (ref `CONTRACT/PS-n`) → EVM AC = certified cost.

## 7. Isometric Drawing Processing

[FINAL] as built:

1. Upload PDF (`/api/documents/upload-url` for direct S3 upload; `/api/documents`
   registers; `noFile:true` allowed). Content-addressed; same bytes never stored or
   processed twice. Unique `(project_id, doc_no, revision, sheet_no)`.
2. Render with pdf.js (`npm run pdfjs:assets`); full sheet + overlapping
   high-resolution quadrant crops.
3. `/api/extract` (maxDuration 300 s): LLM reads the drawing with a fixed prompt
   (mm units, ASME B16.9 take-out table supplied for self-check; unreadable → null
   + `unreadable` list; "never invent a number"); JSON forced (Anthropic prefill /
   `response_format` for vLLM); `lib/llm/parse.mjs` `parseLoose`, `cleanJsonText`.
4. `lib/extraction/sanitize.mjs`, `merge.mjs` → sanitized payload stored in
   `extraction_run.payload` (+ `validation_checks`, `model_name`, tokens,
   `raw_output_uri`).
5. Deterministic engine `lib/engine.js` `buildModel(data)` → route **graph**
   (nodes + optional `edges`; a tee has three edges), welds, spools, cut lengths
   (`lib/standards.js` take-outs, OD), BOM reconciliation (`lib/bom.js`).
6. Review (`/api/review-queue`, `/api/runs/[id]/diff`, `/api/runs/[id]/edits`,
   `extraction_edit`); approve (`/api/runs/[id]/approve`, engineer only) →
   `approved_sha256`.
7. New revision → previous approved run `superseded`; failed extraction of a new
   revision appears in the missing-information register (R3), not silently dropped.

- Coordinates: E / N / EL in mm (`pos_e`, `pos_n`, `pos_el`, `elevation_mm`);
  vector mapping `toVec(n,o) = {x:E, y:EL, z:N}` relative to origin.
- Alternative intake [FINAL]: weld list typed or imported (xlsx/csv/paste) —
  `lib/register/weld-list.mjs` `modelFromWeldList` (unique numbers, Shop/Field
  required, shop weld needs a spool, sheet NPS default), `modelFor(payload)`
  dispatcher (`weldList` vs `buildModel`); listed model → spool length null;
  matching by weld number when position is null.
- [NOT BUILT] OCR engine, symbol/line detection CV, CAD-native (PCF/IDF) parsing,
  P&ID and SLD reading. Planned pattern for P&ID/SLD = same split (model reads,
  engine decides, human signs). [OPEN] which OCR/CV stack.
- Accuracy: engine accuracy (`npm run eval`) ≠ extraction accuracy
  (`npm run extraction:report -- <dir>`, consistency floor vs printed values).
  Field/Shop truth only from a contractor register (tab «حقیقت مرجع», `lib/truth/`).
  [OPEN] extraction accuracy on real project drawings not yet measured.

## 8. Piping / Joint / Weld Processing

- `weld` (per run): `weld_uid` (stable identity across revisions), `weld_no`
  (`W-01`…), `weld_kind` (BW | Tie-in | Closure | …), `shop_field`
  (`weld_location` enum Shop|Field), `joint_role`, `nps`, `schedule`,
  `elevation_mm`, `ndt_requirement`, `pos_*`, `spool_id`, `line_id`.
- Engine rules [FINAL]: welds numbered in route order; `forced` → Field; closure
  welds become Field (BW → Closure); `provisionalNdt(loc)` = Field → "RT 100%",
  Shop → "RT 5% random" **until the piping class is known**, then class/NDT matrix
  rules apply (`piping_class`, `piping_class_size`, `ndt_matrix_rule`).
- `spool` (`spool_no`, `length_mm`, `nps_max`) + `spool_activity` (`code`,
  `status`, `done_at`, `ref_no`, `contractor_id`) + `spool_material`; spool stage
  derived from the chain (no stored `fab_status`).
- Execution: `weld_execution` (`welder_id`, `wps_id`, `process`, `position`,
  `welded_at`, `visual_result`, `qualification_verdict`, `pwht_required`,
  `pwht_report_no`, `pwht_at`); `welder`, `welder_qualification`, `wps`
  (`lib/qualification`).
- NDT: `ndt_record` (`weld_uid`, `method`, `report_no`, `result`, `repair_cycle`,
  `defect_type`, `inspected_at`, `inspector`); `ndt_selection`,
  `ndt_progressive_draw` (ASME B31.3 progressive sampling); fact `is_accepted`
  read by derived NDT steps (F-11).
- Non-piping joints: `weld_joint` (`scope` support/structural/equipment,
  `joint_no`, `tag_id`, `support_id`, `joint_type`, `thickness_mm`,
  `drawing_ref`, `welder_id`, `welded_on`) + `joint_ndt_record`,
  `joint_ndt_selection`, `joint_progressive_draw` (RT/UT/MT/PT/VT per project NDT
  matrix).
- Supports: `pipe_support`; lines: `line` (`line_no`, `piping_class`, `service`,
  `schedule`, `insulation`); tie-ins via `tieInRefsOf` (includes weld-list refs).
- Pressure test: `test_package` (`pack_no`, `subsystem_id`, `medium`,
  `stress_ratio`) + `test_package_line` + `test_record`; the piping test step reads
  done from the accepted pack.
- Engine findings log: `docs/epc-llm/04-engine-findings.md` (F-10 … F-16). A new
  engine gap gets an eval case **before** the fix.

## 9. Equipment Extraction

- [FINAL] Equipment list import (`lib/equipment/parse.mjs` `parseEquipmentList`,
  `importEquipmentList`) and manual single-tag entry → `tag` rows with
  `discipline`, `kind`, `description`, `subsystem_id`.
- [FINAL] Setting/alignment chain via `tag_activity` + precedence; vendor register
  `vendor` (contact fields) used by bids/POs; `vendor_document`,
  `vendor_doc_submission`, `vdt_template`, `vdt_submission`.
- [FINAL] Asset Master: `asset_master`, `asset_master_revision` (ISO 14224 class,
  criticality, maker/model/serial, FLOC); design conditions only with a
  datasheet revision that document control links to **the same tag**;
  `asset_dcs_tag` (DCS and/or Historian id).
- [FINAL] No inference of design parameters from capacity, tag prefixes or tag
  letters beyond what ISA 5.1 itself states.
- [NOT BUILT] Equipment extraction from datasheets/GA drawings by model;
  equipment–nozzle–piping connectivity graph (concept doc §16–17) [OPEN].
- [NOT BUILT] Instruments as independent assets.

## 10. Joint History

- [FINAL] Page `/piping/joint` (`?uid=` weld, `?q=` search spool/line); data from
  `/api/welds?q=` (search) and `/api/welds/[uid]` (one weld's history); **nothing typed on this page** — each
  section is another module's record, in order: drawing revisions carrying the
  weld → register approval → spool/material/heat → fit-up/weld execution (welder,
  WPS, qualification verdict) → PWHT → NDT (incl. repair cycles) → inspection
  hold/witness → test pack/pressure test; plus a list of what does not add up.
- Weld identity: `weld_uid` persists across revisions; `weld_no` per run.
- [NOT BUILT] Heat traceability down to a single weld (currently to spool).
- [ASSUMPTION] Concept-doc "Joint History UI" (§32) is satisfied by this page;
  timeline visuals beyond it not specified.

## 11. AI/ML Components

- [FINAL] Only AI in production path: LLM extraction of isometrics via `lib/llm`
  (provider-agnostic; target = self-hosted vLLM on site because hosted APIs are not
  reliably reachable and drawings/contracts must not leave). Current default
  provider `anthropic`. [OPEN] final model/provider.
- [FINAL] AI never decides Field/Shop, NDT, cut lengths, acceptance; never writes
  setpoints, commands DCS/SIS, or closes a record.
- [FINAL] Evaluation: `eval/` golden + rule cases, `eval/baseline.json`,
  `npm run eval:check` gate in CI; `expect` blocks are written from the
  contractor's register, never from engine output.
- [NOT BUILT] RAG / vector search ("no source → no answer"), predictive maintenance
  ML, agent roles (concept doc §25: Document/Drawing/Isometric/Equipment/Joint-Weld/
  QA-QC/Consistency/Progress/Executive agents) — [UNCONFIRMED] as scope.
- [NOT BUILT] Python services (OCR/vision, ML) — allowed as separate services.

## 12. Database Schema

Migrations `001`–`053` (+`044b`). All project tables RLS. Tables by domain:

- Core: `project` (+ profile, `start_date`), `unit`, `app_user`, `project_member`
  (`project_role` enum: viewer, engineer, qc, admin, designer, contracts, finance,
  hr), `user_credential`, `user_setup_token`, `login_failure`, `contractor`,
  `contract_package` (+`contract_id`).
- Documents/extraction: `document`, `extraction_run` (`run_status`: extracted,
  approved, superseded, failed), `extraction_edit`, `line`, `spool`, `weld`.
- Piping execution: `weld_execution`, `welder`, `welder_qualification`, `wps`,
  `ndt_record`, `ndt_selection`, `ndt_progressive_draw`, `ndt_matrix_rule`,
  `piping_class`, `piping_class_size`, `pipe_support`, `spool_activity`,
  `spool_material`, `weld_joint`, `joint_ndt_record`, `joint_ndt_selection`,
  `joint_progressive_draw`.
- Spine: `subsystem`, `tag`, `tag_activity`.
- Civil/structural: `foundation_spec`, `concrete_pour`, `concrete_specimen`,
  `structure_spec`, `plumb_reading`, `bolting_record`.
- E&I: `cable`, `cable_activity`, `ir_test`, `instrument`, `instrument_activity`,
  `calibration`, `calibration_plan`, `calibration_plan_revision`, `loop_check`.
- Coating: `coating_system`, `coating_item`, `coating_activity`, `coating_record`.
- Registers: `project_assumption`, `project_assumption_revision`.
- Warehouse: `material_item`, `material_lot`, `material_movement`,
  `material_requirement`, `material_reservation`, `stock_count`,
  `stock_count_line`, `mesc_group`, `mesc_entry`, `mesc_import`.
- HSE: `hse_person` (+ `position`, `department`, `employer`
  epc|contractor|client|consultant, `mobilized_on`, `demobilized_on`, `phone`,
  `email`), `hse_competence`, `hse_equipment`, `hse_equipment_inspection`,
  `hse_permit`, `hse_permit_crew`, `hse_gas_test`, `hse_jsa`, `hse_jsa_step`,
  `hse_incident`, `hse_incident_revision`, `hse_manhours`, `hse_observation`.
- Controls: `control_account`, `control_baseline_revision`,
  `control_baseline_point`, `control_progress`, `control_risk`, `cost_entry`,
  `ev_snapshot`, `progress_snapshot`.
- Quality/inspection: `punch_item`, `punch_event`, `punch_photo`, `ncr`,
  `ncr_event`, `itp`, `itp_activity`, `inspection_request`, `inspection_result`.
- Completions: `test_package`, `test_package_line`, `test_record`,
  `mc_certificate`, `precom_template`, `precom_attempt`, `rfc_certificate`,
  `rfsu_certificate`, `performance_guarantee`, `performance_test`,
  `performance_result`.
- Procurement: `material_requisition`, `mr_revision`, `mr_line`, `bid`,
  `mr_award`, `purchase_order`, `po_line`, `po_forecast`, `fat_record`,
  `shipment`, `shipment_line`, `vendor`, `vendor_document`,
  `vendor_doc_submission`, `vdt_template`, `vdt_submission`.
- Document control: `mdr_document`, `mdr_revision`, `transmittal`,
  `transmittal_item`, `doc_review`, `doc_comment`, `doc_reply`.
- Handover/CMMS: `asset_master`, `asset_master_revision`, `asset_dcs_tag`,
  `handover_export`, `pm_task`, `spare_part`, `spare_part_revision`.
- Field: `field_op` (idempotent offline sync).
- Contracts/finance/HR/log (`053`):
  - `contract` (`contract_no`, `title`, `kind` main|subcontract|service,
    `contractor_id`/counterparty, `currency`, `value`, dates, `advance_pct`,
    `advance_recovery_pct`, `retention_pct`, `insurance_pct`, `withholding_pct`,
    `vat_pct`, `overrun_limit_pct` default 25, `status`
    draft|in_review|signed|closed)
  - `contract_line` (`item_no`, `description`, `unit`, `qty`, `rate`,
    `account_id`→`control_account`, `method` platform|design|measured|lump_sum,
    `metric`, `subsystem_id`, `design_code`)
  - `design_quantity` (source PDMS, `model_rev`, `code`, `unit`, `qty`,
    `account_id`, `area`; UNIQUE project/code/model_rev)
  - `pay_statement` (`seq`, `period_to`, `status`
    draft|submitted|verified|approved|paid, frozen money fields, flags,
    prepared/submitted/verified/approved `_by/_at`)
  - `pay_statement_line` (`cum_qty`, `prev_qty`, `sheet_ref`, `evidence` jsonb)
  - `contract_payment` (`kind` advance|statement|retention_release; append-only)
  - `hr_timesheet` (person, `work_date`, `hours`, `overtime`, `account_id`; ≤24 h)
  - `workflow_event` (`section`, `entity_type`, `entity_id`, `entity_label`,
    `action`, `from_state`, `to_state`, `comment`, `user_id`, `at`; append-only).
- Reporting views: `006_reporting.sql` (fact views e.g. `fact_weld` with
  `is_accepted`). [UNCONFIRMED] full view list — read the migration.
- [OBSOLETE] concept-doc table names (`projects`, `joints`, `nde_records`,
  `hydrotest_records`, `audit_events`, …) — use the names above.

## 13. API Design

[FINAL] Next.js route handlers, JSON, cookie session, every call carries
`projectId`; POST bodies use `kind` to select the operation; errors are Persian
messages, 500s masked; authorization via `can()` + area scoping.

| group | routes (`app/api/…`) |
|---|---|
| auth/users | `auth/login`, `auth/logout`, `auth/me`, `auth/setup`, `users`, `projects`, `project`, `units`, `contractors` |
| documents/extraction | `documents`, `documents/upload-url`, `extract`, `models`, `runs`, `runs/[id]`, `runs/[id]/approve`, `runs/[id]/diff`, `runs/[id]/edits`, `runs/[id]/ndt-sample`, `review-queue`, `records` |
| piping | `welds`, `welds/[uid]`, `welds/[uid]/assign`, `welds/[uid]/ndt`, `welders`, `welders/[id]/qualifications`, `piping-classes`, `piping-classes/[id]/sizes`, `ndt-selections/[id]/coverage`, `ndt-joints`, `piping/execution`, `piping/hub`, `spools/[id]/status`, `overview` |
| disciplines | `civil`, `structural`, `electrical`, `instrumentation`, `coating`, `equipment`, `subsystems`, `asset` |
| registers | `assumptions` |
| site/supply | `warehouse`, `warehouse/stores`, `warehouse/mesc`, `procurement`, `procurement/tender`, `field` |
| docs | `doc-control`, `doc-control/incoming`, `doc-control/file`, `doc-control/designer` |
| quality/completion | `quality`, `quality/photo`, `inspection`, `completions`, `precom`, `handover`, `hse` |
| controls/reports | `controls`, `reports/dashboard`, `reports/repair-rates`, `reports/edit-hotspots` |
| contracts/finance/hr/log | `contracts` (GET board or `?statement=`; POST kinds `contract` [`contractKind`], `contract-status`, `line`, `design-import`, `statement-create`, `statement-measure`, `statement-set`, `statement-transition`), `finance` (POST `payment`, `paymentKind`), `hr` (POST `person`, `timesheet`), `log` (GET `?section=&entityId=`; POST comment) |

- `/api/runs` POST: weld-list problems → 400, no run kept.
- [NOT BUILT] WebSocket, `/api/search`, API event model (concept doc §62).

## 14. Frontend

- [FINAL] Next.js App Router pages (41): `/`, `/project`, `/setup`, `/admin`,
  `/contractors`, `/subsystems`, `/asset`, `/assumptions`, `/labels`, `/field`,
  `/piping` (+ `/overview`, `/execution`, `/welding`, `/joint`), `/ndt-joints`,
  `/qc`, `/civil`, `/structural`, `/electrical`, `/instrumentation`, `/coating`,
  `/equipment`, `/warehouse`, `/procurement`, `/documents`,
  `/documents/designer`, `/inspection`, `/hse`, `/quality`, `/completions`,
  `/precom`, `/handover`, `/controls`, `/reports`, `/contracts`,
  `/contracts/statements`, `/contracts/design`, `/finance`, `/hr`,
  `/log/[section]`.
- Navigation `lib/platform/navigation.mjs`: `SECTIONS` groups (incl. «قرارداد،
  مالی و منابع انسانی»); tabs carry `need` (action) and `area`; `LOG_SECTIONS`
  adds `/log/<key>` tab «لاگ و گردش» (`log:true`); `navigationFor` hides a section
  whose only visible tab is its log. Ctrl+K search, light/dark theme, mobile
  drawer.
- Shared UI: `components/ui/TableKit` (search, filter, sort, CSV, view/edit/
  delete), `Tabs` (hash in URL), `Fold` (collapsible forms), `WorkDate.jsx`
  (`localToday`, `projectDay`, `dateOfDay`, `DayHint`, `WorkDateScope`,
  `WorkDateField`), `EntityLog.jsx` (`EntityLog`, `LogList`), `SaveBar.jsx`,
  `WeldListEntry.jsx`, `components/contracts/ui.jsx` (`money`, `Field`),
  `components/platform/Shell.jsx` (`ROLE_FA`, `ACTION_FA`).
- Page files export only the default component (Next.js rule; helpers go to
  `components/`).
- Isometric viewer: pdf.js tiles + three.js 3D (`components/Viewer3D.jsx`). [UNCONFIRMED] click-to-master-data
  per concept doc §31 beyond weld selection.

## 15. Backend

```
app/api/**/route.js        HTTP layer (authenticate, errorResponse)
lib/server/{db,session}.mjs  DB handle, session/identity
lib/db/scope.mjs           withProject()
lib/db/repos/*.mjs         one repo per domain (runs, documents, spine, civil, contracts, finance, hr, log, removal, …)
lib/<domain>/*.mjs         deterministic engines/rules (civil/concrete, contracts/statement, contracts/metrics, completions, hse, ndt, …)
lib/engine.js lib/standards.js lib/bom.js   isometric engine
lib/platform/{modules,workflow,areas,navigation,precedence}.mjs
lib/llm/  lib/extraction/  lib/register/  lib/review/  lib/truth/  lib/storage/
lib/scenario/{dm-pump,runner,guide}.mjs
db/migrations/  db/test/*.mjs  eval/  tools/drive-*.mjs  tools/*.mjs
```

- [FINAL] Shared document stages `lib/platform/workflow.mjs` `STAGES`: draft →
  extracted → in_review → approved → superseded (+ failed); only exit from
  approved is superseded. Modules declare stages, never invent them.
- [FINAL] `lib/platform/modules.mjs`: extraction `status` live only for piping;
  `execution` live for piping, structural, electrical, instrumentation, civil,
  equipment, coating.
- Contracts engine `lib/contracts/statement.mjs`: `METHODS`, `STATUS`,
  `CONTRACT_STATUS`, `CONTRACT_KIND`, `statementMoney` (cumulative; deductions
  advance recovery, retention, insurance, withholding on period gross; VAT added),
  `lineFlags` (block: unmeasured, negative, measured without sheet, > overrun
  limit; warn: > contract qty, below previous), `transitionProblem` (four eyes:
  submitter ≠ verifier ≠ approver; preparer does not approve).
- Metrics `lib/contracts/metrics.mjs` (SQL `$1` project, `$2` date, `$3`
  subsystem): `piping_inchdia_shop`, `piping_inchdia_field`,
  `piping_spools_erected`, `civil_concrete_m3`, `equipment_set`,
  `cable_pulled_m`, `cable_terminated`, `instrument_installed`.
- Measurement methods: `platform` (dated metric), `design` (latest PDMS
  `design_quantity` × WBS EV% at period end), `measured` (qty + measurement sheet
  ref, carried from last approved), `lump_sum` (qty × WBS EV%).
- Dates: `latestToday()` (UTC+14 — "future" = later than today anywhere);
  `pourDateProblem()`.
- Scripts: `dev`, `build`, `db:migrate`, `db:test`, `eval`, `eval:check`,
  `eval:update`, `db:seed`, `demo:seed`, `scenario:dm`, `auth:admin`,
  `auth:developer`, `storage`, `doctor`, `db:backup`, `db:restore`,
  `controls:snapshot`, `extraction:report`, `golden:add`, `pdfjs:assets`.

## 16. Document Processing Pipeline

[FINAL] as built (no orchestrator; synchronous API calls):

```
upload (browser → /api/documents/upload-url → S3 PUT, or multipart/local)
 → /api/documents register (sha256 dedupe; noFile path allowed)
 → /api/extract (pdf.js render + quadrants → LLM → sanitize/merge)
 → /api/runs create (engine buildModel | modelFromWeldList) → extraction_run 'extracted'
 → review (diff, edits) → /api/runs/[id]/approve (hash) → spine/line/weld/spool rows
 → downstream modules read weld_uid/spool/line/tag by id
```

- Document control flow (MDR): incoming transmittal (designer) → revision file on
  storage (hash, duplicates rejected) → IDC distribution → CRS comments carried
  across revisions → reply transmittal with code; reply deadline only from the
  contract term (no default).
- [NOT BUILT] n8n orchestration, job queue, OCR artifacts, page-image store,
  deterministic object naming `projects/<code>/documents/...` from concept doc
  §27 [OBSOLETE → content-addressed keys].

## 17. Demo Dataset

- [FINAL] **DMW scenario** (`lib/scenario/dm-pump.mjs`): DM-water transfer pump
  `P-7001` feeding drum `D-7002`; 72 steps, 11 phases (0–10), 7 people
  (pm/qc/client/designer + contracts/finance/hr for phase 10), 22 refusals
  (11 "آزمون منفی" steps + refusals checked inside other steps). Same step list →
  guide `docs/digital-epc/03-scenario-dm-pump.md` (`npm run scenario:dm -- --doc`),
  auto-play (`npm run scenario:dm -- <email> [--upto step|all] [--creds file]`,
  runner `startFor(150)`), test `db/test/scenario-dm.mjs`. Step 0.1 sets
  `start_date`. All values are scenario data.
- [FINAL] **Olefin demo** (`npm run demo:seed -- <email>`, `tools/seed-demo.mjs`):
  steam cracker in the user's DEMO project — siting, subsystems, contractors,
  packages, equipment list, one isometric register, spool progress, supports,
  foundations/concrete, steel structures. Coordinates = round point near
  Asalouyeh, not a real survey origin.
- Sample drawing: `docs/AISPC-10-DE-930-PI-ISO-0001-REV A0 .pdf`.
- [ASSUMPTION]/[NOT BUILT] Concept-doc **ETH500** (ethane-only ethylene complex,
  ~500,000 t/y, areas 1100/1200/2000/3000): not seeded, not in code. Keep as
  concept-doc assumptions ASM-001…ASM-007 only.

## 18. Demo Workflow

DMW scenario phases (who / where) — [FINAL], details in `03-scenario-dm-pump.md`:

0. Project setup: profile + `start_date`, unit, subsystem, contractors, packages,
   inspection parties (pm).
1. Design documents via designer portal → incoming transmittal → review/IDC/CRS.
2. Procurement: MR → tender/bids → award → PO → FAT → shipment → receipt.
3. Warehouse receipt + MIR under ITP; heat traceability.
4. Civil: foundation, pour (no future dates), specimens (derived test date),
   ACI acceptance.
5. Piping: isometric (file or no-file / weld list) → approve → fabrication, fit-up,
   welding, NDT, erection, test pack/pressure test (recorder cannot accept own test).
6. Coating, equipment setting, E&I: cable, IR, instruments, calibration,
   loop checks.
7. Quality/completions: punch, NCR, MC (refused with named open blockers, e.g.
   «MC امضا نمی‌شود — باز: Punch A باز (1): …»).
8. Pre-commissioning → RFC → commissioning procedures → RFSU.
9. Handover: asset master, PM, SPIR, CMMS export, performance test.
10. Contracts/finance/HR: WBS-70-PIP/WBS-70-EQP (pm) → subcontract SC-70-MEC
    with 4 items (3 platform metrics + 1 measured) sent for review (contracts;
    sender cannot sign) → signed (pm) → advance 6000 (finance; second advance
    over 10% refused) → statement 1 to day 125 (qc): 9 + 9 inch-dia, 2 set,
    2 supports on MS-70-01; gross 3,945, net 2,800.95 → verify + comment (pm;
    no final approval offered to the verifier) → approve (contracts; AC
    WBS-70-PIP 945, WBS-70-EQP 3,000) → pay (finance; over-net refused) →
    HR welder + 12 h on WBS-70-PIP (hr; day before mobilisation refused) →
    log shows every step and person.

- Browser drives: `tools/drive-*.mjs` (e.g. `drive-contracts.mjs` 35 checks,
  `drive-weld-list.mjs`); the whole scenario through the forms:
  `tools/drive-scenario-dm-ui.mjs` (`SCENARIO_FROM=<phase>`, `SCENARIO_UNTIL=<step>`),
  one signed-in browser per person.
- Contracts demo flow: contract (draft → in_review → signed; sender cannot sign)
  → BOQ lines → PDMS import → statement create → remeasure → submit (qc/contracts)
  → verify (engineer) → approve (contracts) → payment (finance) → `cost_entry` →
  EVM AC.

## 19. Project Assumptions

- [FINAL] Assumptions are **data**: `project_assumption` +
  `project_assumption_revision`, status Proposed → Approved / Rejected /
  Superseded, owner, revision history; change = new revision.
- [FINAL] No default spec values (curing period, erection standard, circuit
  voltage, tolerances, inspection intervals, residual-risk limits, competence
  matrix, JSA-required permit types, FX rates, reply deadlines) — undefined →
  missing-information register.
- Concept-doc assumptions (not project facts): ASM-001 ethylene complex,
  ASM-002 ~500,000 t/y, ASM-003 ethane-only, ASM-004 internal utilities, ASM-005
  storage/export, ASM-006 ETH500, ASM-007 areas 1100/1200/2000/3000,
  ASM-008 isometrics + master lists as sources — all [ASSUMPTION], none loaded.
- ASM-009 human validation, ASM-010 no DCS/SIS control, ASM-011 UNKNOWN stays
  UNKNOWN, ASM-012 provenance — [FINAL] (enforced as rules).
- [ASSUMPTION] Deployment target: owner's own server (Postgres + MinIO), site
  network without reliable access to hosted LLM APIs.

## 20. Important Decisions

| # | decision | status |
|---|---|---|
| D1 | Model extracts, engine decides, human signs | FINAL |
| D2 | Next.js + PostgreSQL (PGlite/server) instead of FastAPI rewrite ("existing system first", no rewrite without reason) | FINAL |
| D3 | RLS per project, `withProject()` | FINAL |
| D4 | One spine (`tag`/`subsystem`), references by id | FINAL |
| D5 | Approved register hash-locked; correction = new revision | FINAL |
| D6 | Shared workflow stages; transitions store action VALUES | FINAL |
| D7 | UNKNOWN, never a guess; missing-information register | FINAL |
| D8 | Derived steps refuse hand ticks; sign-offs refused while prerequisites open | FINAL |
| D9 | Records never deleted; only unreferenced mis-entries (`removal.mjs`) | FINAL |
| D10 | Content-addressed storage; S3/MinIO optional; no silent fallback | FINAL |
| D11 | LLM provider behind `lib/llm`; target self-hosted vLLM | FINAL (provider OPEN) |
| D12 | Statements cumulative, four-eyes, approval posts `cost_entry` | FINAL |
| D13 | Log = `workflow_event` ∪ derived signatures (no copy) | FINAL |
| D14 | Future date = later than today anywhere (UTC+14) | FINAL |
| D15 | Save register without drawing file (`none://no-file`); file attaches later | FINAL |
| D16 | Weld register by hand/Excel uses same NDT rule as geometry register | FINAL |
| D17 | Tests must fail when the fix is reverted (mutation-checked); drive real browser | FINAL |
| D18 | Before commit: `npm run db:test`, `npm run eval:check`, `npm run build` | FINAL |
| D19 | Python only as separate services beside the DB | FINAL (none built) |
| D20 | OT segregated; operational data only via historian/DMZ | FINAL |
| D21 | One PR per module from now on (R5) | FINAL (process) |

Obsolete ideas: FastAPI core, monorepo `apps/packages/services`, concept-doc
table names, ETH500 as the live demo, `fab_status` stored column, per-module
stage names, typed-subject dev identity (replaced by real auth).

## 21. Known Limitations

- Extraction live only for piping isometrics; other disciplines' drawings not read.
- No OCR/CV pipeline; relies on a multimodal LLM + engine checks.
- Extraction accuracy on real project drawings unmeasured (needs contractor
  registers as truth).
- EV history only from first monthly snapshot; no WBS weighting above control
  account.
- Heat traceability stops at spool, not single weld.
- No PAC certificate, no start-up log, no IOGP monthly report, no crew
  competence per role, no inventory valuation, no pipe cut-waste.
- No vendor self-service VDT portal; no weighted bid scoring policy.
- `xlsx` 0.18.5 (R4): advisories on **reading**; since 36477f4 the weld-list import
  reads user-chosen xlsx **in the browser** (`WeldListEntry.jsx`) — exposure is
  now client-side read [OPEN: replace with maintained SheetJS or `exceljs`].
- SSO/Keycloak seam only; no identity server.
- Backups: `db:backup`/`db:restore` exist; server schedule + first restore drill
  not done.
- PR #1 very large (~70+ commits); unmerged.

## 22. Open Questions

```
[OPEN] Final LLM model/provider and on-site vLLM hardware
[OPEN] OCR engine / CV architecture for drawings (Python service?)
[OPEN] CAD-native parsing (PCF/IDF, PDMS/E3D export formats beyond design_quantity import)
[OPEN] P&ID and SLD parser (planned, same split)
[OPEN] Vector store (pgvector vs Qdrant) and RAG scope
[OPEN] n8n adoption and queue technology
[OPEN] Identity provider (Keycloak/OIDC) and final RBAC matrix per organisation
[OPEN] Production deployment topology (single node vs multi; PGlite vs server Postgres)
[OPEN] KPI formulas for dashboards (Power BI model on reporting views)
[OPEN] CMMS/SAP/ERP integration contract (export format consumed by owner's CMMS)
[OPEN] Actual project document formats and real drawings for accuracy measurement
[OPEN] Statement edge cases: price adjustment/escalation, variation orders, multi-currency FX — not modelled
[OPEN] HR: payroll/leave out of scope? (only personnel + timesheets built)
[OPEN] Finance: budget vs commitment approvals, invoices beyond statements/advances
[OPEN] Merge strategy for PR #1
```

## 23. Current Status

- Branch `claude/vigilant-brown-wnaksu`, draft PR #1; last commits: 982f398
  (vendor register, manual equipment, designer portal), 9d5510d (project day,
  no future pours), 36477f4 (no-file save; weld register by hand/Excel),
  b7122d9 (scenario drive upload), f037706 (MC refusal in words), 404c4ed
  (contracts, statements on WBS/PDMS, finance, HR, section log).
- Migrations 001–053; 56 `db/test` suites in `npm run db:test`, all passing at
  404c4ed (incl. contracts 14/14, users 12/12, api 24/24, removal 9/9);
  `eval:check` gate passed; `next build` clean; `tools/drive-contracts.mjs`
  problems: none; full DMW scenario UI drive after the log-tab navigation change:
  106/106 ok, problems: none; phase 10 (contracts → statement → payment →
  HR → log) through the forms: problems: none.
- Docs: `docs/digital-epc/00-master-plan-alignment.md` (plan vs built),
  `01-ecosystem-review.md`, `02-project-review.md` (R1–R11), `03-scenario-dm-pump.md`,
  `04-glossary.md` (§19 contracts terms); `docs/epc-llm/00–05`.
- Delivered outside repo: DMW scenario PDF report, user guide PDF (roles,
  prerequisites); guide artifact https://claude.ai/artifact/DTDZqMrkeqZxk9fAb79sxb
  [UNCONFIRMED: guide does not yet cover contracts/finance/HR/log].

## 24. Next 10 Development Tasks

1. Update the user guide (PDF/artifact) with contracts, statements, finance, HR and
   «لاگ و گردش», incl. who does each step and prerequisites.
2. Replace `xlsx` 0.18.5 (R4) now that the browser reads user files; keep
   export and import tests.
3. Merge PR #1 (R5), then one PR per module.
4. Measure extraction accuracy on real project isometrics with contractor weld
   registers (`extraction:report`, «حقیقت مرجع»).
5. P&ID / SLD reading on the isometric pattern (schema + engine rules first).
6. PAC certificate and start-up log after performance tests.
7. Statement extensions: variation orders, price adjustment, multi-currency with
   an explicit FX source (no guessed rates).
8. Heat traceability to single weld + instruments as independent assets; then
    Power BI model on reporting views with agreed KPI formulas.
9. Schedule `db:backup` on the server and run the first restore drill (R2).
10. Second statement period in the DMW scenario: carried-forward measured quantities,
    retention release, closing the contract.
