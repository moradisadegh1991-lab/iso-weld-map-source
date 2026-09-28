# Session Handoff

```yaml
date: 2026-09-28
branch: claude/vigilant-brown-wnaksu   # draft PR #1
canonical_context: docs/digital-epc/EPC_AI_MASTER_CONTEXT.md
```

## Session Goal
Owner requests (Persian): day-N date entry, «ذخیره در سامانه» error, weld register by
hand/Excel, DMW scenario PDF report + user guide, contracts/subcontracts +
payment statements (صورت وضعیت) on WBS and PDMS, finance, HR, a log per section;
then a canonical master context.

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
- DMW scenario phase 10 (steps 10.1–10.11): WBS, subcontract SC-70-MEC, advance,
  statement 1 measured by the platform and a measurement sheet, four-eyes
  verify/approve, payment, HR welder and timesheet, and the log. New scenario
  people: `contracts`, `finance` and `hr`. The guide was regenerated (72 steps),
  and the browser drive gained phase 10.

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
- Migration 053 adds `contract`, `contract_line`, `design_quantity`,
  `pay_statement`, `pay_statement_line`, `contract_payment`, `hr_timesheet` and
  `workflow_event`.
- It also adds `contract_package.contract_id` and the `hse_person` HR fields.

## API Changes
- New routes: `/api/contracts`, `/api/finance`, `/api/hr`, `/api/log`.
- `/api/documents` accepts `noFile`.
- `/api/runs` returns 400 on weld-list problems.

## UI Changes
- New nav group «قرارداد، مالی و منابع انسانی».
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
- `scenario-dm`: 72 steps, 22 refusals. The phase 10 browser drive found no
  problems. The "sender signs" guard was revert-checked: the scenario test fails
  without it.

## Known Issues
- `xlsx` 0.18.5 is now used to read files in the browser (R4).

## Open Questions
See the master context §22.

## Next Tasks
See the master context §24. The user guide PDF and the interactive
scenario guide were updated with contracts, finance, HR, the log and phase 10.
First on the list now: replace `xlsx`.

## Important Context
- Before committing, run `npm run db:test`, `npm run eval:check` and `npm run build`.
- Revert-check every new test.
- Drive the real app in a browser.
- Run the secret guard on the staged diff.
- Answer the owner in Persian.
