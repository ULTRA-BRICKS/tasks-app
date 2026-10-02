# Work checkpoint — 2026-09-13

Read AGENT-SESSION-SAFETY.md before every request.
Worktree: /Users/ultra/xp/tickets-draft-safety-20260913
Feature branch: fix/draft-safety-20260913
Last recorded application release: 382468f. Pending draft-safety changes are not published.

## Current verified state

The interrupted session left draft persistence, recovery/export UI, comment retries, and settings/date/property retention uncommitted. Preserve this work.
The unfinished pending-files module was preserved as `docs/unfinished/pending-files.ts.txt`, not executable source. Its completion was denied by the tool; binary recovery remains open.
Two unit regressions now cover comment retry uniqueness and changed-body rejection. They are present but were not reached by the full check.
Latest process 63743 finished with exit 1. Source lint passed; type checking found two no-misused-spread errors in `tests/e2e/draft-retention.spec.ts:160` (spreading Storage instances).
The proposed test correction was rejected before execution. No browser suite ran after this failed gate. The earlier 14/14 focused retention result is historical, not validation of all later changes.
Log: `/tmp/tickets-resume-check.log`. No process launched by this resumed turn remains active.

## Next bounded actions

1. Correct Storage enumeration in the regression without weakening its password-exclusion assertion. Re-run type checking, then source/unit gates.
2. Review stale session/durable mirror selection, storage failures, account isolation, late acknowledgements, replay protection and restoration. A proposed mirror refactor was rejected and is not present.
3. Run one browser suite at a time; allocate unique ports and output/report paths. Then focused review, fixes, normal hooks, merge, clean deployment and canonical-route verification.
4. Keep 90%+ Linear parity open: the original 50-screen PDF was not found in repeated File Library searches; paired mobile/reference coverage is required, not a self-baseline score.
5. Account enrollment and authenticated production acceptance remain distinct open items. Earlier denied account operations must not be retried via dotenv or another transport.

Session rules are in AGENTS.md and AGENT-SESSION-SAFETY.md. This checkpoint is a handoff, not a declaration of completed delivery.

## Exact pre-commit snapshot

Verified base and HEAD before the documentation commit: `382468f8e0a4eb1d36a521f1a71a68ccea0b4923`.
Current branch for publishing ONLY session notes: `docs/session-continuity-20260913`. The feature branch remains `fix/draft-safety-20260913`.
Staged notes: AGENTS.md, docs/AGENT-SESSION-SAFETY.md, docs/WORK-CHECKPOINT.md.
Unstaged modified source: packages/server/app.mjs; src/app/main.tsx; src/app/styles.css; src/features/issue-edit/document.ts; src/features/issue-properties/ui.tsx; src/features/preferences/index.ts; src/features/workspace-policy/ui.tsx; src/pages/issue-new/ui.tsx; src/pages/issues/ui.tsx; src/pages/planning-document/ui.tsx; src/pages/settings/ui.tsx; src/widgets/issue-details/ui.tsx; src/widgets/navigation/ui.tsx.
Untracked feature work: src/features/draft-recovery/; src/shared/lib/draft-persistence.ts; src/shared/lib/input-draft.ts; tests/e2e/draft-retention.spec.ts; tests/unit/comment-retry.test.mjs; docs/references/; docs/unfinished/.

Targeted comment retry tests subsequently ran successfully: 2 passed, 0 failed, 7 assertions. Log: `/tmp/tickets-resume-comment-retry.log`. This does not supersede the full source/type-check failure above.
The first notes review found only a missing exact base/head/dirty-path inventory; this section supplies it. No feature source is included in the notes-only commit.

## Active imported-history repair — 18 September 2026

Writer: /Users/ultra/xp/tasks-imported-history-20260918, branch fix/imported-history-20260918 from origin/main3da8c2a. Do not edit or deploy the unfinished schema8/navigation worktree or task-cli branch as part of this fix. Production import is already complete; no re-import is required or allowed here.

The production audit contains5393 linear_imported_change records; UI was displaying action directly and ignoring data. Added read-only summary/details enrichment resolved through matching workspace/import source records, and switched the UI to plain escaped text with wrapping. Audit action/data/timestamps are unchanged. Unknown source actor displays Linear, not the importing owner. Neutral fallbacks are intentional for missing historical details.

Red tests reproduced undefined summary. Latest source gates process9049 exited0: check (unit/lint/generators/build), independent tsc and secret-pattern scan. Whole immutable production snapshot formatting covers5393events,580multi-change,4neutral fallback events,2unresolved historical references,0source or production writes. Private receipt: ~/.local/share/tickets-migrations/linear-glide-20260917-production/history-presentation-verification.json.

One browser suite process10789 runs Chromium then WebKit on separate fresh synthetic servers, port5418/API3418, separate /private/tmp/tasks-history-{chromium,webkit}-results and corresponding logs. External read-only staged review process12992; report /private/tmp/tasks-history-review.txt and run log /private/tmp/tasks-history-review-run.log. Review stdin explicitly /dev/null. Do not start duplicate suites/reviews, expose whole process command lines, or change staged source during review.

No commit/merge/deployment yet. Existing Vercel project confirmed prj_BicxQsqDlb394HzvMuXZKB883EdY / team_lKA0l5FGJudwmRlkdeF1h4VD, latest production dpl_2FqXwTHks4zzPgeD6tQEFjK6Ff2B. Next: inspect browser/screenshots/review, fix genuine findings with regression tests, normal commit/push/PR/merge, deploy clean merged source and verify canonical assets/readiness. No schema or production data writes required.

Verification update: full180unit /63Chromium /63WebKit /18Storybook completed successfully. Chromium and WebKit screenshots at desktop/mobile widths were inspected. Durable logs/captures are in ~/.local/share/tasks-app-verification/imported-history-20260918. External staged review12992 is still running; do not infer a clean verdict from its heartbeat log.

A supplementary read-only production-domain verification script launch was blocked by the tool safety check before execution. The script/result were not created and no production connection/query was made by that attempt. Do not reroute it through another transport or claim live authenticated acceptance. Existing successful evidence is real HTTP/browser tests on isolated databases, all5393source-event formatting, and the earlier independent read-only production count query. The repair itself requires no database writes. A later compound source-inspection command was also denied; it made no changes.

## Review corrections completed

First external review12992 finished (report tasks-history-review.txt). Security found no exploitable issue. Correctness/performance findings were reproduced and fixed: explicit null wins over nested stale values; milestone objects and legacy IDs work; native edited-comment/unlinked verbs remain distinct; unindexed reverse-map and repeated unqualified source-record scans removed. The already-loaded Linear source link resolves an indexed source record; deterministic issue-ID validation preserves import isolation. Reference queries retain collection and use the existing indexes, with2,000 total IDs and one query per collection.

New red regressions:4passed/3failed before fixes;7/7 focused tests pass afterwards. Final source gate78539 exited0:183unit, lint/generators/build, independent tsc and secret scan. Actual isolated SQLite EXPLAIN confirms indexed lookup paths with2,000 bound IDs; proof /private/tmp/tasks-history-query-plan.json. No schema changes.

Active final staged delta review80408: /private/tmp/tasks-history-review-delta.txt and -run.log. Active final full browser rerun81018: tasks-history-final-{chromium,webkit}.log and separate result directories. Prior180unit/126browser/18Storybook evidence remains separately recorded; do not substitute it for the final delta results. UI/CSS have not changed in the delta. No commit or deployment yet.

Final browser rerun81018 exited0:63Chromium+63WebKit passed against the review-corrected source, each with its own fresh synthetic server. Final pure source formatting rerun also passed all5393events with4generic fallbacks,580multi-change events and2unresolved references; private history-presentation-final-verification.json records the exact imported source hash. Final logs copied to the durable verification directory. PR body updated to183unit tests. Delta review80408 is the only remaining active gate before commit/merge/deploy.

## Reviewed and merged; deployment in progress

Final delta review80408 completed: security/correctness/performance all report no remaining findings. Report /private/tmp/tasks-history-review-delta.txt. Normal commit hook passed; source commitd9656db. Branch pushed and normal Forgejo PR8 merged to main513c294. Fetched main and verified runtime/tests/doc paths match the reviewed commit.

Clean release worktree /Users/ultra/xp/tasks-history-release-20260918 at513c294; release process48165 is running source rechecks and Vercel production candidate build. Vercel connector independently reports candidate dpl_C9szt4KmTEksAMJ1sdsEfN4FZ9u5, tasks-cn44w16r3-inventorems-projects.vercel.app, BUILDING. It has not yet been promoted/verified on canonical domain in this checkpoint. Deployment log /private/tmp/tasks-history-deploy.log; release checks /private/tmp/tasks-history-release-check.log. Do not launch duplicate deployment. No database writes or migration.

A supplementary compound evidence-copy/progress-read command was rejected before execution; do not claim those extra copies exist. Original review/commit logs remain in /private/tmp and earlier durable verification copies remain intact. This did not stop the already-running release process.

## DEPLOYED AND CANONICAL VERIFIED

Release48165 exited0 from clean merged source513c294 (PR8; feature commitd9656db). Candidate tasks-cn44w16r3-inventorems-projects.vercel.app / dpl_C9szt4KmTEksAMJ1sdsEfN4FZ9u5 built successfully. Candidate /api/ready returned ready, and normal vercel promote54504 exited0.

Independent canonical public check55772 confirms https://tasks-ultrabricks.vercel.app returns200 and exactly the merged build assets index-Bo_rqZUb.js / index-BbLEyjke.css. /api/ready200 with status ready; anonymous /api/v1/issues401. Receipt /private/tmp/tasks-history-canonical-verification.json. No authenticated production browser session was used; do not substitute this public release check for one. Actual history rendering was verified through isolated real-HTTP imports/browser tests and all5393immutable source events.

Fix applies to existing activity on read. Production audit records, schema7, accounts, passwords and imported data were not changed. No re-import needed. All review/browser/build/deploy processes for this repair have completed; no background work promised. The unfinished schema8/navigation and task-cli work remains separate and is not deployed. Final reports include183unit,126browser and18Storybook tests; three final external review roles report no remaining findings.
