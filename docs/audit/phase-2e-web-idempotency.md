# Phase 2e — retry-safe web spool operations

Date: 2026-11-12. Backlog: EPC-04, web retry-safety subtask. Baseline master: `bd39c2f3647714592dc76dc0863e3f3db07facab`.
Original draft PR #93 head: `98a6ae362d046c103b752226395c710fda1c8008`.

## Behaviour and scope

`POST /api/piping/execution` with `kind: activity` requires a stable UUID `opId`. The authenticated actor and the normalized command fingerprint bind that id to one result. A matching retry returns `{ activity, replayed: true }`; a changed payload or actor returns `409 OP_ID_CONFLICT`. Authorization and project membership are checked before invoking the operation wrapper. Other execution actions and the offline command path retain their existing contracts.

The activity, any material-override event and the immutable receipt are committed in one transaction. A transaction-scoped advisory lock serializes the same operation across server workers. UUIDs are normalized before computing the lock key and request fingerprint: PostgreSQL treats upper/lower-case UUIDs as equal, so the lock must do so too. An operation id already used outside the caller's project produces a safe conflict after the attempted transaction rolls back; another project's receipt is never returned.

The browser retains the **complete command**, including an override reason, in session storage scoped to actor/project/spool/step. It reuses the UUID and reason on retry, including when a new page instance reads the pending entry. A successful POST alone does not clear it: the refreshed detail must also succeed. An older acknowledgement cannot clear a newer command. Double clicks are suppressed while the step is in flight. If storage cannot retain the command, the page refuses to submit it. A deliberate change to the command gets a new UUID.

This is retry safety for the **same operation id**. It is not deduplication of every independently created operation against the same spool/step. Browser persistence is session storage; closing the tab or clearing storage is not a durable background outbox. A pending operation is not automatically submitted on page load. Successful replays return the original receipt, including after re-derivation has removed the original spool/activity rows; they do not recreate those rows.

## Defects found in the original draft

| Defect | Reproduction / correction |
|---|---|
| A step-button retry has no override argument, so the old signature logic can replace the pending UUID/reason | Retain the full command; the client test refuses to mint a second UUID on retry |
| The pending UUID was removed before the detail refresh | Keep it until the detail refresh succeeds; browser aborts that GET and retries the same operation |
| Session-storage keys did not include the actor | Separate actor queues; the client test switches actor and checks separate keys/UUIDs |
| Storage errors silently fell back to an unretained operation | Fail before POST; browser test observes zero submissions with storage blocked |
| Lock keys used case-sensitive UUID text while the database UUID was case-insensitive | Mixed-case simultaneous retries must yield one receipt; reverting normalization fails the real PostgreSQL test |
| The ledger revoked application UPDATE/DELETE but allowed ordinary table-owner mutation and incomplete results | Add migration 121; verify owner UPDATE/DELETE/TRUNCATE refusals and complete-result constraints |

## Tests and guard proofs

- `db/test/material-override.mjs`: **21/21** after the changes, including rollback when receipt insertion fails, replay, actor conflict, UUID normalization and immutable receipts. The original draft passed 18/18; the added case/owner guards reproduced failures before the fixes (19/21).
- `db/test/web-spool-operations.mjs`: **9/9** focused checks. Covers persisted full commands, changed commands, actor isolation, late acknowledgements, storage failures, authenticated API validation, equivalent JSON results on replay, payload/actor conflicts, cross-project UUID collision rollback, receipt retention and incomplete-receipt refusal. Included in `db:test`.
- Complete `db:test:pg` against disposable PostgreSQL 16: **8/8, 16/16, 5/5, 3/3, 4/4**. The material-concurrency web case sends six retries with mixed UUID case, checks one activity/event/receipt, checks cross-project rollback and tests table-owner immutability. No PGlite serialization is presented as proof of pool concurrency.
- `tools/drive-web-spool-operations.mjs`: **7/7**, zero page errors, Chromium against the production build. It creates synthetic test runs attached to a repository sample PDF in an explicit test project. After the server commits an override, it drops the POST response and retries from the real page; the UUID/reason remain unchanged and one override exists. It separately drops the detail GET after a successful POST and checks retry safety, then blocks browser storage and observes zero submissions. No extraction accuracy is measured.

Guard-reversion checks, each restored before the final checks:

| Removed guard | Observed failure |
|---|---|
| UUID normalization for the lock | Real PostgreSQL material suite: 15/16; mixed-case concurrent web retries conflict |
| Retain the previous override reason on button retry | Client/API suite: the lost-response test attempts to mint a second UUID and fails |
| Migration 121 | Client/API suite: 8/9; an incomplete receipt is accepted |

The complete build/eval/PGlite results are recorded in the PR description. The API map was regenerated with `npm run tiles:map`; its contents did not change.

The first complete PGlite chain stopped at the schema-key catalogue: `web_spool_operation` was missing from the explicit list of client-supplied primary keys. It is now documented alongside `field_op` in `db/test/numbering.mjs`, preserving the browser-issued operation id rather than adding a server-generated default. The catalogue test was rerun and the complete chain restarted; the earlier failure is not reported as a passing run.

Final local results: the complete `npm run db:test` chain completed **129 suites, exit 0**, without failing cases. `npm run build` passed and `npm run eval:check` printed `GATE PASSED`. External MinIO and PostgreSQL backup checks in the PGlite chain were explicitly skipped for absent connection settings; those checks are not counted as external-service validation. The separate real PostgreSQL concurrency chain above was run and passed. No production recovery exercise was performed.

## Migration and deployment

This PR requires **120_web_spool_idempotency.sql and 121_web_spool_operation_integrity.sql**. The committed 120 migration is preserved; hardening is additive in 121. The client and server must be deployed together after migrations are applied. Older custom HTTP clients must start supplying a retained UUID; old browser pages should reload. Internal `recordSpoolActivity` callers and offline `field_op` processing are unchanged.

Before an authorized deployment, back up the database and files, inspect the installed migration versions/checksums, then run `npm run db:migrate`. With `DB_AUTO_MIGRATE=off`, this must be an explicit deployment step. Do not treat a successful build as evidence that migrations ran on production.

If a pre-existing deployment has table `web_spool_operation` from 120, check for incomplete receipts before applying 121:

```sql
SELECT to_regclass('public.web_spool_operation');
-- Run only when the table exists:
SELECT op_id FROM web_spool_operation
 WHERE result IS NULL OR jsonb_typeof(result) <> 'object'
    OR NOT (result ? 'id') OR result->>'id' IS NULL;
```

Run this read-only preflight with an authorized maintenance account and the appropriate project scope (or a backup administrator able to inspect all projects). Non-empty results need investigation; the migration does not invent results, rewrite audit history or silently delete receipts. Immutable rows also prevent ordinary hard project deletion that would cascade through these receipts. Retention/purge policy must be handled explicitly in any future project-purge feature.

No production migration or deployment was performed. The disposable PostgreSQL test container/image was removed after testing. MinIO, production backup/recovery and real-project pilot acceptance are separate work. PR #94's historical spool association remains outside this change. Keep this PR as draft until the owner requests merging.
