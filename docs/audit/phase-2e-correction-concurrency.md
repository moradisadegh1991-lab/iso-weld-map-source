# Phase 2e — correction versioning and concurrent audit history

Date: 2026-11-12. Completion-backlog item: EPC-04 (correction subtask only).
Baseline: master `439bf2440759f9a46199ed00f90f1ff5e30de0e9`; original draft PR #92 head `0e51fec1d13950d1fac7c52a49e97169dfc46f28`.

## Failures reproduced

1. The original draft required 64 hexadecimal characters in `baseHash`, but the unchanged public `payloadHash()` emits 32. Normal clients were refused with `400 BASE_HASH_REQUIRED`. The existing engineering-CRUD suite reproduced five failures (11/16 passed).
2. The draft's double-escaped regular expressions stopped excluding added `weldList[i].uid` and `weldMarkup.byUid.*`. An identity/display-only change became three engineering correction records. The new database regression reproduces this failure.
3. The correction response hashed its in-memory object; PostgreSQL JSONB may reorder keys. Its token could therefore differ from a subsequent GET of the same saved payload. A client using the response token could receive a false stale-edit conflict. The new route regression reproduces the mismatch.
4. On master, the payload and edit diff were read before locking. A legacy internal caller without a token could record the wrong `before_value` after another writer committed. A stale no-op returned before any version check. Real PostgreSQL tests reproduce both defects while another transaction holds an uncommitted write.

## Final behaviour

- The HTTP correction API requires the existing server-issued token format: **32 lowercase hexadecimal characters**. Missing, null, empty, non-string and malformed tokens are refused after authorization. The hash algorithm and other consumers are unchanged.
- The run row is read with `FOR UPDATE` inside the correction transaction, before checking editability, checking the version, computing the diff, or returning a no-op. Stale requests return `409 STALE_RUN` without changing payload, register or audit records.
- Added persistent weld identities and display positions remain excluded from engineering correction metrics, as on master.
- `UPDATE ... RETURNING payload` supplies the response fingerprint from the stored JSONB representation. A successful response and the next GET name the same version.
- Audit rows, payload replacement and register persistence remain one transaction. Authorization, project scope, document-type guards and approved-run locks are retained.

Internal repository callers may still omit `baseHash` for compatibility. They are serialized and their audit diffs use the locked current state, but omission cannot detect whether their submitted full payload was prepared from an old version. HTTP callers must supply the token. Custom API clients must read it from GET and retain/reload after a successful correction.

## Tests and guard-reversion evidence

`db/test/review.mjs` adds route-contract and identity/display-only cases. The route test covers a server-issued token, current no-op, actual correction, response/GET token agreement, stale no-op, invalid token types and absence of side effects.

`db/test/correction-concurrency.mjs` is included in `npm run db:test:pg`, so the existing PostgreSQL 16 CI job runs it. It verifies:

1. Eight simultaneous edits of one base version: exactly one succeeds, seven are stale; only the winner is logged; weld identity survives.
2. A legacy internal edit waits for another uncommitted writer and records that writer's committed value as its audit `before_value`.
3. A request that appears to be a no-op against the old committed payload waits for the writer, then refuses the stale token, without replacing register rows.
4. Cross-project corrections fail and approved runs remain locked.

The concurrency tests observe real `pg_stat_activity` lock waits; they do not treat PGlite's single-connection serialization as proof of pool behaviour. Use a dedicated PostgreSQL test database whose test account can inspect its own sessions and apply the existing role migrations. Without `PG_TEST_URL`, the suite explicitly reports SKIPPED.

Guard checks performed locally, restoring the corrected source after each run:

| Reverted behaviour | Observed failure |
|---|---|
| Original PR #92 token validation | Existing engineering-CRUD acceptance/race/lock tests fail with 400; new issued-token regression fails |
| Original PR #92 escaped metadata filters | New identity/display-only regression logs UID and position changes |
| Master's pre-lock diff and no-op return | PostgreSQL suite: 2/4 passed; incorrect audit before-value and missing no-op lock wait |
| Hash the pre-storage object again | Review suite: 26/27 passed; response token differs from GET |

## Verification record

Focused checks after the fixes: review **27/27**, engineering CRUD **16/16**, correction concurrency on PostgreSQL **4/4**.
The complete PostgreSQL chain passed locally against a disposable PostgreSQL 16 container: **8/8, 15/15, 5/5, 3/3, 4/4**. The container was removed after the tests.

The reusable browser drive `tools/drive-correction-concurrency.mjs` passed **7/7 checks**, with zero page errors, against the production build in Chromium and a separate local fixture database. It signs in, opens one synthetic run in two windows, saves the first correction, observes the stale second window's conflict/reload UI, verifies the saved token and unchanged winner, reloads, and saves again. It requires an explicit dedicated test project code and test credentials; it makes no model call and does not measure drawing extraction accuracy.

The initial combined build/PGlite run was invalidated by disk exhaustion (`ENOSPC`) while the Docker image occupied the limited workspace. Build failed and API fixtures could not write files. After removing the disposable container/image and old build artifacts, these checks were restarted. Final results are recorded in the PR description; the disk-exhausted run is not a passing result.

Final local checks after freeing disk space: `npm run build` passed; `npm run eval:check` printed `GATE PASSED`; the full `npm run db:test` chain completed **128 suites, exit 0**, with no failing cases. Its external MinIO and PostgreSQL backup checks were explicitly skipped because their connection settings were absent. The separate real-PostgreSQL concurrency chain above was run and passed; PostgreSQL backup/recovery and MinIO integration were not tested here. `git diff --check` and the browser script syntax check passed.

## Deployment and remaining work

No schema migration. No production database, runtime settings or deployment is changed by this work. Keep PR #92 as a draft until the owner explicitly requests merging.
This closes only the correction portion of EPC-04 after validation. Web-operation retry safety (#93), spool-history provenance (#94), pilot acceptance and production deployment remain separate work.
