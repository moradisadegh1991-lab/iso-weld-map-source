# EPC / ISO weld-map platform — notes for every session

Next.js 15 + PGlite (Postgres-compatible). Persian UI; the owner writes Persian, code and commits are English.
The engine rules and what counts as proof are in `.claude/skills/epc-platform/SKILL.md` — read it before touching the engine, an extraction pass or any accuracy claim.

## How work is delivered
- Default branch is **`master`**. Each change is its own branch and its own **draft PR**; never push to `master`.
- Mark a PR ready and squash-merge **only when the owner says «مرج کن»**. Tell the owner what was and was not verified.
- Schema changes are **additive migrations only** (`db/migrations/NNN_*.sql`). A new migration must be run on the server: say so in the PR.

## Before opening a PR (`/verify` runs these)
1. `npm run tiles:map` — whenever a page's API calls change (a hook does this after edits under `app/`, `components/`). `db:test` fails with «tile-apis.mjs is out of date» otherwise.
2. `npx next build`
3. `npm run eval:check` — must print `GATE PASSED`.
4. `npm run db:test` — **over 10 minutes**: run it in the background.
Prove a guard by reverting the code it protects and watching the test fail; for UI work, drive the real page in the browser (Playwright is pre-installed) on a sample PDF, not just unit tests.

## Gotchas
- Stop a stale server with `ps aux | grep "[n]ext-server" | awk '{print $2}' | xargs -r kill`. **Never `pkill -f next-server`**: it matches the shell running it.
- After `next build`, restart the server; an old one serves stale chunks and the login page hangs on «در حال بارگذاری».
- Plant equipment lives in `app/api/equipment`, `lib/db/repos/equipment.mjs`; the sheet's installed items are `iso_equipment*` — different things.
- Tables on `/piping` are **display-only**; a row is viewed, edited and added in a form (`components/ui/FormDialog.jsx`, `MarkForm`, `BomForm`, `CutForm`), also from the sheet's right-click menu.
- Plant data is noisy: missing values, sensor noise, irregular timestamps; SI units.
