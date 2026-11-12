# Spool override history association review

Reviewed on 2026-11-12 against master `7adc967acf8317131c0ec9b071424cbaf1a0dd50`, retaining the changes from PRs #92 and #93. Original PR #94 head: `3f3a9e475f3418ed6c810f5dcbd609ecfb04e6dd`.

## Result and boundaries

The read-only history query now reports its association basis. `exact_spool` means the event references this database spool row; it does not mean engineering approval or proven physical identity across revisions. Associations found by drawing number, sheet and printed spool number remain explicitly unverified, including re-derivation within the same extraction run.

The execution page identifies exact, same-run, same-revision and other-revision associations in Persian, English and Arabic. A pure presentation helper requires consistent server evidence. Missing, malformed, contradictory or future metadata displays an unknown association. History rows remain immutable; this change neither carries decisions forward nor authorizes a new activity.

This is not the final spool identity solution. Trusted spool UID snapshots and explicit `revision_carry_map` lineage remain follow-up work. Number reuse, renumbering and absent historical identity cannot be solved by this display change.

## Verification

- Focused retention suite: 15/15, including real re-derivation, new run, new revision, renumbering, sheet/project isolation, route output, immutable history and three-language presentation.
- Guard proofs: restoring the old reader fails the association assertions; trusting `same_spool` alone fails the unknown/contradictory-contract assertion. Both source files were restored before final checks.
- Production build and evaluation gate passed; `tiles:map` produced no tracked change.
- Real Chromium against the production build with local PGlite and a sample PDF: 9/9 checks. The driver creates synthetic extraction payloads attached to the PDF, exercises correction/new-run/new-revision routes, checks original event snapshots, three languages, a 390px viewport and missing/invalid response metadata. No browser page errors. This is workflow evidence, not an extraction accuracy claim.
- Full database chain: all 129 suites passed, exit status 0, including the expanded 15/15 retention suite and inherited web retry tests.

The repeatable browser driver is `tools/drive-spool-history.mjs`; it requires an explicitly selected test server, project and credentials and creates test data. No production access was used. There are no new transaction/concurrency writes in this phase, and no new external PostgreSQL concurrency run is claimed.

## Deployment

No new schema migration. Master already includes migrations 120 and 121 from PR #93; their VPS execution remains with the owner, who chose to deploy through GitHub. Production application and migration execution have not been verified here. PR #94 remains draft pending owner merge instruction.
