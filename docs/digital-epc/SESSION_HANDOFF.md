# Session Handoff

```yaml
date: 2026-10-03
branch: claude/vigilant-brown-wnaksu   # draft PR #1
canonical_context: docs/digital-epc/EPC_AI_MASTER_CONTEXT.md
```

## Session Goal
Owner requests (Persian): day-N date entry, «ذخیره در سامانه» error, weld register by
hand/Excel, DMW scenario PDF report + user guide, contracts/subcontracts +
payment statements (صورت وضعیت) on WBS and PDMS, finance, HR, a log per section;
then a canonical master context.
Follow-up request (2026-09-29): an automatic PK for every table; form numbers
from form code + sequence; contractor site work as a draft until the employer
approves; parallel work fronts (spool shop beside civil); a work-front page by
material (day/week/month/all); work orders for work outside the contract,
from a TQ or a site change (site-run / as-built), with the designer's part.

## Completed
- 9d5510d: «روز پروژه» input and `DayHint` beside work dates; test date derived
  from pour + age; future pours refused (`latestToday()` UTC+14).
- 36477f4: register saved without a drawing (`none://no-file`, file attaches
  later); weld register typed or imported (xlsx/csv/paste) via
  `lib/register/weld-list.mjs`.
- f037706: MC refusal names open blockers in Persian (`BLOCKER_FA`).
- 404c4ed: migration 053; contracts, BOQ lines on WBS, PDMS `design_quantity`,
  `pay_statement` four-eyes workflow posting `cost_entry`; finance board and
  payments; HR personnel and timesheets; `workflow_event` + derived signatures →
  `/log/[section]` and `EntityLog`.
- PDFs delivered outside the repo: DMW scenario report and user guide.
- This file and `EPC_AI_MASTER_CONTEXT.md`.
- R4: `xlsx` 0.18.5 → SheetJS 0.20.3 (vendor CDN, integrity-pinned). Browser read,
  template write and the 5-sheet export were driven; the Node drive now needs `XLSX.set_fs(fs)`.
- DMW scenario phase 10 (steps 10.1–10.11): WBS, subcontract SC-70-MEC, advance,
  statement 1 measured by the platform and a measurement sheet, four-eyes
  verify/approve, payment, HR welder and timesheet, and the log. New scenario
  people: `contracts`, `finance` and `hr`. The guide was regenerated (72 steps),
  and the browser drive gained phase 10.
- 5612dc7: migration 054 `form_counter`/`form_code`; `lib/numbering.mjs` FORMS
  registry (PTW, INC, JSA, PC, TP, PT, MR, PO, SH, MRR, STK, CT, TR, RT, NCR,
  IR, P per subsystem; now also TQ, FCR, WO). A blank number field is issued
  `CODE-0001` right before INSERT, skipping numbers typed by hand; the project
  may change a form's code (پروژه › «کد فرم‌ها و شماره‌گذاری خودکار»). A test
  audits that every table has a primary key.
- 933b14d: migration 055 claims. With `project.site_work_approval` on, a step
  recorded by a contractor-side member is a claim (`in_progress` + `claimed_on`)
  that counts nowhere until a company-party member approves it on
  «تحویل کار پیمانکار» (`/work-approval`); reject needs a reason.
- Work front (`lib/workfront.mjs`, `/workfront`): what each front (spool shop,
  civil, equipment, piping site, E&I, coating) can start by material on hand or
  arriving — today / within a week / within a month / later, unknown material
  and blocked work listed separately; the parallel fronts shown together.
- Changes (migration 056, `lib/db/repos/changes.mjs`, `/changes`, designer
  portal tabs): TQ → designer answers → engineer closes (no change / change
  required); site change (site-run, field change, as-built) → approved by
  another → designer declares the as-built revision → closed only when that
  revision is in the MDR; work order → issued by someone other than its
  preparer → becomes a measured `WO-…` item on the signed contract → paid via
  the next statement on its WBS.
- A step waiting only on claimed steps is `claimable`: the contractor may
  declare it while approval catches up; it stays `blocked` for sign-offs.
- Scenario: 5.1–5.4 (spool shop) now run beside civil (after 3.4), with 5.2a
  checking the parallel fronts; phase 11 (11.1–11.15) plays claims, TQ, FCR,
  as-built and WO-0001 through statement 2. Guide regenerated (88 steps) and
  printed in play order («فاز 3 (ادامه)»).

- 2026-10-03, real drawings: 55 area-25 isometrics + project MTO + the
  contractor's joint history (data NOT in the repo — public repo). Findings
  F-18 (printed joint numbers ignored; SW/THD/OLET = 63% of joints, unknown to
  the geometry engine) and F-19 (register columns mis-mapped, whole-project
  register not cut to the sheet). New `welds` extraction pass →
  `lib/register/weld-marks.mjs` (Shop/Field from the project's declared
  symbols, migration 057; type from printed THD / branch / the sheet's BOM;
  blanks left for a person) → weld-list form. `npm run weldmap:truth`
  scores extractions against a register; 7 sheets read before seeing the
  register: 124/124 joints, Shop/Field 100%, size 99.2%, type 96.1% on 76
  (48 blank). `tools/drive-weldmap.mjs` drove it in the browser (stub LLM).
  See `docs/epc-llm/06-real-isometrics.md`.
- 2026-10-03, golden (repo now private): all 54 area-25 sheets are eval
  cases `eval/cases/golden/HDPE-25-*` (803 joints; PDFs + per-sheet BOM in
  the repo, the raw register/MTO still not). `npm run golden:marks` writes
  them: input = what is printed (`weldMarks`), expect = contractor register;
  `_disputes` (25 fields on 19 joints where drawing ≠ register) are left out
  of expect for the piping engineer — table in 06-real-isometrics.md. New
  rules: printed «BR» → BR; a frame numbered 0 is excluded and named. A loc
  dispute drops spoolCount from expect. 54/54 pass; 251 fields left blank
  for a person. The real `welds` pass still needs an API key to be scored.
- 2026-10-09, K110 P&ID (owner: «read the olefin P&ID and bring it in as a
  project»): `P&ID K1.zip`, 242 AutoCAD sheets with text as strokes. Page
  OCR (`tools/pid-ocr.py`, RapidOCR) + instrument bubbles from geometry
  (`tools/pid-bubbles.py`) → `lib/pid/ocr-parse.mjs` → registers by the
  set's own legend (`lib/pid/legend-k110.mjs`) → `tools/pid-registers.mjs`
  (`data/k110/registers.json` + Excel) → `npm run pid:load` (project K110).
  370 equipment, 3103 lines (91 held: fluid not in legend), 5698
  instruments, 242 drawings, 368 revisions issued, 760 problems for the
  engineer. Eye-read sheets: instruments 77/77, 41/43, 15/15 with no wrong
  tag. OCR slips repaired only by stated rules (inch mark as X, dropped
  first letter, OA = 0A, clashing readings file nothing). Driven in the
  browser on a fresh database. See `docs/epc-llm/07-pid-k110.md`.
- 2026-10-10, report workflow phase 1 of 5 (owner's spec for staged reports,
  daily report first): migration 058 (`report_type`, `report_stage`,
  `review_group`, `group_member`, `report`, append-only `report_version` /
  `report_signature` / `report_decision`, `report_recipient`), rules in
  `lib/reports/workflow.mjs`, repo `lib/db/repos/reports.mjs`, form
  `report` (DR-R0001), log section `reports`. Signatures attest to a
  version; approval needs the approver's own signature; a return reopens
  the stage before; cancel only before any approval. `db/test/reports.mjs`
  11/11, every rule revert-checked. Next: phase 2 (signature image, admin
  pages for stages/groups/members). See `docs/digital-epc/report-workflow.md`.
  User guide (Persian, role-based, real screenshots): `docs/digital-epc/guide-daily-report.pdf`
  (self-contained source `guide-daily-report.html`).
  Reviewed `daily report.zip` (Access, 6 projects incl. Kavian furnace 10,
  116k manpower rows mixing people/machines/materials in one column; most
  reports undated in this file; holds a plaintext password and contractor
  national IDs) — not imported yet.
- 2026-10-10, report workflow phase 2: migration 059 `user_signature`
  (append-only, type sniffed from bytes, ≤1 MB; served only within a project
  its owner is in) and `report_signature.signature_id` (a signature keeps the
  image it was given with); `/signature` (draw or upload) and `/report-setup`
  (types, stages, groups, members, daily-report template) under a new menu
  section «گزارش‌های مرحله‌ای» with its log. reports 16/16, each rule
  revert-checked; driven in the browser at 1440 and 390 px, no errors.
- 2026-10-10, report workflow phase 3: `/daily-reports` + `/api/daily-reports`;
  content rules `lib/reports/daily.mjs` (people / machines / materials in
  separate lists, a material needs a unit, whole non-negative heads, temps
  and humidity in range); `dailyPrefill` offers the day's timesheets,
  finished or claimed steps and HSE with their source. daily-report 3/3,
  each rule revert-checked. Driven with three accounts through a return and
  to final approval.
- 2026-10-10, report workflow phase 4: print layout. Migration 060
  (`report_print_layout` versions, `project_logo`, both append-only); rules
  `lib/reports/print.mjs` (paper, heights leaving ≥40 mm body, header cells
  fitting the header, logos of this project only, footer element order and
  styles, one row in landscape / perRow in portrait, placeholders);
  `components/reports/PrintSheet.jsx` (print: table with repeated header and
  footer; preview: scaled page with draggable dividers); pages
  `/report-print-setup` and `/daily-reports/print`. print 4/4, each rule
  revert-checked. Real PDF from the browser: landscape A4, 2 pages, header
  and signature boxes on both. Fixed: print clipped at one page because the
  app's body is a viewport-high scroll box.
- 2026-10-10, report workflow phase 5: migration 061 `resource_catalog`;
  `lib/reports/catalog.mjs` turns Access `manp_list` + `GRP_MANP` into 460
  items (people without the wrong man-hour unit, one unit spelling, 11
  duplicates merged, 21 crews inactive, 29 problems named);
  `data/daily-access/catalog.json`; `/report-catalog` (import button, add,
  activate) and `npm run daily:catalog -- <code>`; the daily form suggests
  from it and fills discipline / unit only into empty fields. Not imported:
  Kavian contracts 600/601 (contractor = owner, no value), contractors (only
  Kavian itself for project 6000), undated manpower history. catalog 4/4,
  each rule revert-checked; driven in the browser. All five phases done.

## Changed Files (main)
- `db/migrations/053_contracts_finance_hr_log.sql`
- `lib/contracts/{statement,metrics}.mjs`
- `lib/db/repos/{contracts,finance,hr,log,documents,civil,completions,removal}.mjs`
- `lib/register/weld-list.mjs`
- `app/api/{contracts,finance,hr,log}/route.js`
- `app/{contracts,contracts/statements,contracts/design,finance,hr,log/[section]}/page.jsx`
- `components/{WeldListEntry,SaveBar}.jsx`
- `components/ui/{WorkDate,EntityLog}.jsx`
- `components/contracts/ui.jsx`
- `lib/authz.mjs`
- `lib/platform/{areas,navigation}.mjs`
- `db/test/{contracts,civil,api}.mjs`
- `tools/drive-{contracts,weld-list}.mjs`

## Architecture Decisions
- Statements are cumulative. Deductions are taken on the period gross; VAT is added.
- Four eyes: the submitter, verifier and approver must differ.
- An approved statement posts to `cost_entry`, so EVM AC equals certified cost.
- The log is built by UNION with derived signatures; nothing is copied.
- New roles: `contracts`, `finance`, `hr`, plus the `COMMENT` action.

## Database Changes
- 054 form numbering, 055 work claims, 056 `tech_query`, `site_change`,
  `work_order`, `contract_line.work_order_id` (all RLS project-isolated).
- Migration 053 adds `contract`, `contract_line`, `design_quantity`,
  `pay_statement`, `pay_statement_line`, `contract_payment`, `hr_timesheet` and
  `workflow_event`.
- It also adds `contract_package.contract_id` and the `hse_person` HR fields.

## API Changes
- New routes: `/api/contracts`, `/api/finance`, `/api/hr`, `/api/log`,
  `/api/numbering`, `/api/work`, `/api/workfront`, `/api/changes`.
- `/api/documents` accepts `noFile`.
- `/api/runs` returns 400 on weld-list problems.

## UI Changes
- New nav group «قرارداد، مالی و منابع انسانی».
- New section «جبهه کاری و تحویل کار» (اجرا): جبههٔ کاری، تحویل کار پیمانکار،
  دستور کار، TQ و تغییرات، and its log.
- `FormNo` field: a blank number shows «خودکار: X».
- A «لاگ و گردش» tab on every mapped section.
- A section with only its log visible is hidden.

## AI/Extraction Changes
- `modelFor(payload)` dispatches between the weld list and `buildModel`.
- `provisionalNdt` is exported and shared by both paths.
- No LLM changes.

## Tests
- All `npm run db:test` suites pass (56), including contracts 14/14, users 12/12,
  api 24/24 and removal 9/9.
- `eval:check` passes and `build` is clean.
- The `drive-contracts` browser drive found no problems.
- Full DMW scenario UI drive after the navigation change: 106/106 ok,
  problems: none.
- 2026-09-29: all 60 db suites pass (numbering 4, claims 7, workfront 4,
  changes 4; each revert-checked). Browser: drive-numbering, drive-claims,
  DMW phases 3–10 and phase 11 — problems: none.
- `scenario-dm`: 88 steps, 24 refusals (was 72 steps, 22 refusals). The phase 10 browser drive found no
  problems. The "sender signs" guard was revert-checked: the scenario test fails
  without it.

## Known Issues
- None open from this session. R4 is fixed: `xlsx` 0.20.3, and `npm audit` reports 0.

## Open Questions
See the master context §22.

## Next Tasks
See the master context §24. The user guide PDF and the interactive
scenario guide were updated with contracts, finance, HR, the log and phase 10.
R4 (`xlsx`) is done. First on the list now: merge PR #1.

## Important Context
- Before committing, run `npm run db:test`, `npm run eval:check` and `npm run build`.
- Revert-check every new test.
- Drive the real app in a browser.
- Run the secret guard on the staged diff.
- Answer the owner in Persian.
