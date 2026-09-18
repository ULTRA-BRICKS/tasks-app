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
