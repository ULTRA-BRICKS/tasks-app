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

## 2026-09-18 — isolated state-lib pilot, not the older dirty feature worktree
Current worktree: `/Users/ultra/work/hyper-canvas-draft-worktrees/tasks-app-state-lib-pilot`; branch `pilot/state-lib-HYP-1464`. Started at `39e21e9`, merging current origin/main `1d3ac4d`; the only conflict (preference entry) is resolved. New density behavior from main is preserved in both backends. Baseline preference implementation exactly matches current origin/main.

Actual completed gates: density RED→GREEN (5 tests, 1500-operation comparison); full `bun run check` exit 0 (188 unit tests, lint, FSD, types, build); same 6 Chromium/WebKit browser scenarios passed for state-lib and 6 for baseline. Source review is running under the normal review-cli pool; log/PID are in the sibling evidence directory. No main merge or deployment authorized/performed.

Blocked writes: the proposed Boards UI integration and Tasks document-controller creation were rejected before execution. Neither implementation should be assumed present. The proposed Tasks controller test was moved from the active unit suite to `docs/state-lib-pending/document-controller.contract.ts.txt`; it is a pending specification, not green evidence. Do not retry denied operations through another transport, an agent, staged fragments or renamed equivalents.

Independent successful work is preserved. Reports: `docs/STATE-LIB-MIGRATION-REPORT.md`. Evidence directory: `../state-app-migrations-20260918/`. Codex delegation hit its usage limit and made no edits; no coding agent is active. Four additional issue creations were rejected as a batch and are not registered. Project state-lib, existing HYP-1464 and newly created child HYP-1497 were successfully written and read back in tasks-app, not Linear.

Before resuming, inspect actual git/review/commit state. Preserve unrelated `.metadata_never_index` and all other worktrees. Never call this a complete domain migration or a performance win. Publish only reviewed, tested allowed changes with normal hooks; leave production unchanged.

## 2026-09-18 — current isolated continuation (supersedes the old worktree above)
Current worktree: `/Users/ultra/work/hyper-canvas-draft-worktrees/tasks-app-state-lib-HYP-1497`; branch `feat/state-lib-HYP-1497`, based on `1d3ac4d21d64e9ba77d4ccd05fdbe436e567f436`. The older pilot worktree and its resolved merge remain untouched, including its exact staged-index hash `206ea934afe33de6baeeba684b558b2fbe75f971ff5f6d186ae9bab6447a6fe0`.

All 349 tracked files matched byte-for-byte immediately after transplantation. New independent changes since then: two RED→GREEN persistence contracts plus unknown-version protection/persisted-projection suppression, and these updated docs. `bun install --frozen-lockfile`, full check (192 unit tests, lint/FSD/types/build), and A/B browser runner (6+6 Chromium/WebKit) passed in this new worktree. No tests were weakened and the pending editor specification stays outside the executable suite.

Evidence remains at `../state-app-migrations-20260918/`; see tasks-candidate-equivalence.json, tasks-persistence-red.log, tasks-persistence-green.log, tasks-isolated-check.log, tasks-isolated-ab.log. The older large review finished with inherited-main findings; its stamp will NOT be used for this branch. Run full staged review on this index and normal commit/push only. Do not merge main or deploy.

HYP-1498 is a distinct newly reproduced persistence issue, successfully created in state-lib and related to HYP-1464. Its app-adapter protection is now implemented, but shared persistence API/UI diagnostics remain open. HYP-1497 is In Progress. The earlier four denied issue creations and denied Boards/Tasks editor wiring were not retried.

Published Boards source: 8909dbcc83bc4bcf743e40409e4f3621653a830d; report update: 90859a8f5647503e106e1c1f830dc604168b3a02, PR9. Tasks next gate: review the actual ~90 KB pilot diff, commit/push a non-draft comparison PR, update reports and both task cards, read back all remote SHAs. A prior patch attempt failed because the user's Git config emits no a/b prefixes; explicit src-prefix/dst-prefix fixed it with a clean-index check and full file equivalence validation.

## Published continuation — final source gate
Source `ee0d530df2f095f0fa2a7e6bd7b6edb1f2ec24e2` is pushed to `origin/feat/state-lib-HYP-1497`; normal PR12 is open against main. Full staged Sonnet review produced usable correctness/performance/quality verdicts, exit 0; ordinary Git hooks passed. The earlier Opus timeout was not treated as approval. No production merge/deploy.

Validation: 192 unit tests, 9 preference contracts, full lint/FSD/types/build; 6+6 core browser scenarios and 12+12 density scenarios all pass on the final implementation. Four current Tasks screenshot pairs are pixel-identical. Evidence: tasks-final-sonnet-review.log, tasks-isolated-commit.log, tasks-isolated-push.log, tasks-isolated-pr.log, final-comparison-evidence.json.

HYP-1497 and HYP-1498 remain In Progress: Boards document-store is still unwired, Tasks issue-editor remains unimplemented, and shared persistence/UI diagnostics/cross-tab contracts remain unfinished. Original pilot worktree/index hash is unchanged. Resume from this new branch, not from the preserved large in-progress merge. Source reviews and browser suites are complete; next work must address an actual remaining feature/permission boundary rather than blindly repeating the release chain.

## 2026-09-18 — real document integration and measured evaluation
Current writer worktree is tasks-app-state-lib-HYP-1497, feat/state-lib-HYP-1497. A real Runtime issue-editor controller and persistence status/cross-tab/Settings UI are now connected. The original inline hook remains the selectable baseline; parent keys by account/workspace/issue. No agent is active: the stalled delegation was stopped before any source edits.

Verification: 209 unit passed, 1 FAILED (HYP-1499, disposal from subscriber poisons subsequent cleanup). Three ordinary attempts to correct that ordering were rejected by the tool and no fix was applied. DO NOT remove/skip the test or claim a green full check. Common browser cases: 40 candidate +40 baseline pass; corrected persistence cases 4/4 pass; real editor typing benchmarks 9+9 pass with 3 page replicates per workload. Type-aware checking and selected-backend builds pass independently.

Reports docs/STATE-LIB-EVALUATION.md/.json distinguish TS Runtime, app adapter and inherited server guarantees. HYP-1500/1501/1502 research tasks and HYP-1499 bug were actually created in state-lib after measured results. Evidence: ../state-full-integration-20260918, evaluation-full.json, research-created.json, browser benchmark logs and raw JSON.

Boards now has the actual document-store/Undo/Redo UI integration, 117 unit tests and four full document browser combinations green. Ordinary edits are approximately3x slower at controller level; next-frame UI shows no general speedup. Do not advertise normalization, universal performance wins or completed production acceptance. Main/production and old dirty worktrees remain untouched. Next gate is full review of exactly these sources, then publish only with normal hooks and explicit experiment/incomplete status.

## Published real integration — final handoff
Tasks source b66348cda1e8c1e7730a7374b0e7bde031aa3fbd is pushed to feat/state-lib-HYP-1497 (PR12); Boards source7e08e8004e9e72833680c77ceb46d123f9876f72 is pushed to pilot/state-lib-HYP-1464 (PR9). Normal Git hooks were used. Full three-role source reviews completed; no source reviewer remains pending.

Final Tasks full-check is RED:210 passed/1 failed out of211, HYP-1499. Do not report release acceptance. Extra review found a future-schema→compatible-event unsaved-preference overwrite; a new RED→GREEN and stronger existing oracle fixed it, and4 actual cross-tab/quota browser cases passed. All7 persistence contracts plus9 preferences pass. Common browser40+40, benchmark9+9 passed; clean selected builds remeasured with --emptyOutDir.

Reports docs/STATE-LIB-EVALUATION.md distinguish benchmark revisions and measurements from unimplemented goals. Actual research cards HYP-1500/1501/1502 and bugHYP-1499 are in state-lib underHYP-1464. Main/production and old dirty worktrees remain untouched. Preserve .serena/.metadata_never_index untracked metadata. The pending .txt draft contract was a historical source of requirements; its tests and real controller are now implemented, with the specific cleanup exception above.

## 2026-09-18 — HYP-1499 lifecycle correction

Current source remains feat/state-lib-HYP-1497 in tasks-app-state-lib-HYP-1497, based on d307911d408c75bec7c886270f57e3fa51a520ef. Preserved .serena/ and .metadata_never_index; original worktrees, boards-app and vendored Runtime are unchanged. Tracker HYP-1499 was resolved through the configured tasks-app CLI (not Linear) and set In Progress at version3.

The previous rejected correction was freshly approved in normal scope0a5e8956ce8e. Actual RED: retained controller test failed; with four added regressions the group was11pass/5fail. Only successful Runtime.dispose now revokes controller active/disposed/generation/requested/inFlight state. A rejected call from a notification, transaction or pure derivation leaves the controller usable and preserves subscriptions and the pending save queue. Core protections were not changed.

Focused tests16/16, full unit215/215, complete bun run check (generation, lint/FSD, type-aware checking, unit, build) passed. On a separate synthetic local HTTP instance, all40state-lib and40baseline editor/preferences/navigation/Markdown/conflict/reload/logout Chromium/WebKit cases passed. These are correctness reruns, not new speed/heap measurements. Eight vendor output hashes still match provenance.

Evidence and active owners: ../state-lifecycle-20260918/run-98379b7d7f/CHECKPOINT.md. Next: review the exact staged correction, normal commit/push to this experiment branch, update PR12 and tracker with confirmed SHA. Do not merge app main or deploy production automatically. The completed website feedback release is independent and must not be repeated. After this bug, HYP-1500/1501/1502 remain the measured next work; no blanket bug-free/production-ready claim.
