---
description: Run this repo's pre-PR checks in order and summarise (tiles:map, build, eval:check, db:test)
---

Run these in order from the repo root and report each one's result. Stop and say what failed at the first failure; do not skip or weaken a check.

1. `npm run tiles:map` — then `git status --short lib/platform/tile-apis.mjs`; if it changed, say so (it must be committed).
2. `npx next build` — report only errors.
3. `npm run eval:check` — the engine gate; must print `GATE PASSED`.
4. `npm run db:test` — takes **over 10 minutes**, longer than a foreground command may run: start it with `run_in_background`, redirect to `/tmp/db-test.log`, and wait for the completion notice. Then `grep -c "  FAIL" /tmp/db-test.log` must be 0 and the exit code 0.

Finish with one line per check (pass / fail + the failing test's name) and whether it is safe to open the PR.
$ARGUMENTS
