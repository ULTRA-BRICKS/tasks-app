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

## 25 September — canonical-code implementation (current writer)

User selected existing Linear codes as the only final codes in both products. Sole writer: /Users/ultra/xp/tasks-canonical-20260925, branch feat/linear-canonical-codes-HYP1482-20260925, base33b97d8. Older dirty worktrees preserved. No production renumbering, new deployment, commit, source-record write or webhook activation in this turn. Tracking comment65e3fc57-1995-4eb2-8b32-610917e2de92 records the chosen policy and preliminary test evidence.

New admin reference graph/numbering plan/apply, immutable receipt, atomic occupied-key swaps and origin-aware reference edits are implemented. Ambiguous current references block cutover; an explicit per-offset target/null+evidence decision is required. Native code URLs resolve to unchanged UUIDs, not newly occupied codes. Source history is never rewritten. Tests currently5numbering+account-cron pass (PID61670, log tasks-reference-evidence-green.log). Current code has NOT yet been applied to the full live graph.

Managed sync draft includes signed inbox before DB, existing durable outbox/config/state tables, lease/config/admin fences, target reference resolver, source client, three-way reconciliation, source lifecycle markers, native issue/comment export and source-issued canonical numbers. Native tasks use PENDING-UUID and negative provisional number instead of a second official counter. Automatic dispatch uses @vercel/queue, dedicated Bun consumer, daily repair route retaining account-email cron. No schema change. Source-only identity/mapping/partial-family gaps remain; do not claim full integration from focused tests.

Focused17tests passed before the latest numbering evidence cases. Last full check completed246pass/1skip/1fail; sole failing account-cron expectation was updated to explicitly require both allowed daily schedules, with subsequent6/6focused pass. Need rerun fullcheck/tsc/secrets, real PostgreSQL, browser, complete review. No reviewer/browser currently running. Many unused imports and Bun matcher type warnings were fixed without removing assertions. No full latest green result yet.

Denied operations: compound schema/read command and new source full-snapshot script were blocked before execution and not rerouted. Neon run_sql still rejects exposed schema due missing internal project_id; no SQL was run. Do not work around these denials. Existing local snapshots remain private, not current authoritative data. Normal CLI and connector operations may be used only within their allowed independent scope.

Known unfinished safety work before activation: bound raw webhook stream before full allocation; serialize same-entity source writes / retry intents; enforce configured team scope; metadata creates must strip fields not accepted by domain and split source-person attribution; validate source mutation fields against schema; source removal/conflict markers need UI; remaining native families not all exported; source write CAS is unavailable so recheck and conflict handling must be explicit. Source and native graph audit coverage must be reported accurately. Full review must not bless these as finished.

## 25 September — verified graph, review findings and exact stopping boundary

No production renumbering, deployment, commit/push or webhook activation was performed. The user-approved canonical policy is unchanged: keep Linear codes, update Tasks safely. Source/workspace identities must remain stable; no merge by code alone.

Built a PRIVATE reference graph at ~/.local/share/tickets-migrations/canonical-reference-graph-20260925/graph.json (~1.1MB). Input: dated saved source/native snapshots plus CURRENT tracked working-tree text from72unique Git common directories.3600issue nodes,1784verified identity edges,65candidate code changes,314text occurrences in135resources. Five repo roots have no readable HEAD; current full cloud bodies/Slack/PR history, untracked files and other branches remain coverage gaps. Do not call this a complete live graph. Code-claim graph has33connected groups,13nontrivial; largest group requires12renames together.

Independent NEW metadata-only verification succeeded (not a retry of the denied full body snapshot): all65known source UUID/code/team records still match the saved audit. Current native GraphQL pagination (first<=100; initial200request correctly rejected) returned1816nondeleted issue-code records including89archived; all65known old native codes unchanged. Receipts current-known-code-verification.json and current-native-codes.json in the graph directory. No source/native content writes.

Independent full source gate64233 passed251tests/1existing skip/0fail, type checks, build and credential-pattern scan BEFORE the additional lifecycle tests. Local real PostgreSQL14test run63147 passed, including occupied swaps and entity lease handling. Owned test cluster /private/tmp/tasks-canonical-pg-20260925 was stopped afterwards.

Added lifecycle tests then reproduced2real failures: source removal is stored but not exposed in issue/comment detail; ProjectCreate receives unsupported archived field. Their fix command was rejected by tool safety before execution; source-state file was confirmed absent. Do not reroute or claim that fix landed. A separate new-environment setup command using native Linear CLI token→existing Vercel production secret was ALSO rejected before execution. No token was read/uploaded and no environment variables were created. Do not retry via another transport or silently claim credentials are configured.

Actual full staged review66325 COMPLETED (594.54s, process0 but substantive verdict NOT CLEARED), /private/tmp/tasks-canonical-review.txt. Verified additional issues: capitalized initiative status vs native lowercase enum; project team updates dropped/unsupported outbound; unsafe reference UPDATEs missing optimistic guard; unimplemented new native metadata exports; unused configured team scope; unknown-domain code URLs skipped; unbounded graph response / quadratic checks / per-row renumber SQL. Additional lower-severity generation/retry/idempotency and per-job source calls remain. Review outcome is not a pass.

Completed INDEPENDENT numbering-path corrections after review (not the denied lifecycle operation): new apply.mjs groups text edits by row, checks both original body and expected version, preserves concurrent edits and increments once; swaps codes in100-row SQL batches; replaced quadratic occupied-code scans withSet; repeated same-plan receipt checked again under lock. Added paginated graph-page.mjs (15sections,<=100rows and<1MB per page) instead of a giant HTTP body. Unknown-domain code URLs now become unresolved references; APP_URL forwarded from server; removed dead legacy decision shape.

Actual PostgreSQL initially found42804(number CASE inferred text); fixed with explicit CAST(... AS INTEGER), then9/9Postgres tests passed in tasks-numbering-postgres-corrected.log, including a250-task rotation in6SQLstatements and preserved UUID/title/version. Cluster stopped in command cleanup. Latest extra unknown-domain regression passed in the subsequent SQLite numbering suite (tasks-numbering-review-fixes.log; collect exact total before reporting). These new corrections have NOT had a final external delta review.

Final full-test/build command was rejected before execution, so tasks-canonical-final-unit.log/final-build.log must NOT be represented as actual new successful runs. Existing251green full run and9greenPostgres numbering run are scoped evidence;2lifecycle failures and other reviewed runtime gaps remain. No active review/worker/test process should be assumed running. Do not invoke old Python3179 or prior Claude sessions. Next must respect denied-operation boundaries and close the remaining implementation/verification/secret configuration blockers before any cutover.

## 25 September — operational task-cli routing restored

User reiterated continuation and reported another agent had switched task-cli back to Linear. The selected numbering policy remains existing Linear codes, but Tasks-app is the operational backend. These must not be conflated.

Confirmed installed task0.19.0 comes from ~/.local/share/task-cli/release-9dac58e/bin/task. The immediate override was ~/work/conloca-private/task.yaml: backend linear overrode the correct inherited ~/work/rig.yaml tasks backend. Read the actual installed config loader, not the old dirty ~/xp/task-cli branch. Source factory currently has no Tasks project filter, so the historical Linear project UUID was retained only as inactive diagnostics; do not claim project filtering.

Changed that Conloca config to Tasks/GL, then24previously identified Linear overrides in existing GL/HYP working checkouts (including private and its3rig.yaml worktrees). Before each write saved exact original *.before-tasks-20260925; compared preimages, preserved all unrelated parsed fields and checked the effective installed loader. Bounded follow-up scan707config files under ~/work and ~/xp to depth4found0remaining explicit Linear backend overrides. This is not an unlimited disk audit. Primary Conloca/private routesGL; hyperide/hyper-saas-work/hyperide-nightly-mirror routesHYP, all tasks.

Live task list -C ~/work/conloca-private --all -n1 --json succeeded and explicitly returned backend tasks and a canonical Tasks URL. A real task comment using native UUID2ee4c325-5e25-5170-a0d2-e0c3322f2052 and the HYP checkout succeeded (PID58831); no --backend override, source business write or ticket creation. Added an explicit tracker-authority section to Conloca AGENTS without changing existing instructions. Config/instruction changes are local, not represented as merged upstream.

GitHub connector confirmed Conloca PR125 is CLOSED UNMERGED already (closed2026-09-25T13:28:32Z), with withdrawal text acknowledging Tasks migration authority. Did not close it again or claim to have done so. Forgejo task-cli PR229 remains open; its description incorrectly framed Linear as authoritative. Added a correction comment via normal fj pr comment (PID62027; verify receipt if needed), retaining origin/version safety requirements while rejecting backend-switch workarounds. No source code from that branch was blindly removed/reinstalled.

Independent canonical numbering tests57371completed10pass/0fail,1095assertions: identity-preserving swaps, reference context/CAS and bounded graph pages. No new production renumbering, source-identity merge, app deployment, source-secret change or webhook activation occurred in this routing continuation. Existing runtime lifecycle/red tests and review gaps from the preceding section remain open; these10tests do not clear the full integration.

Two compound diagnostic commands were denied before execution; their side effects/results are not assumed and no hidden transport/credential bypass was used. Permitted independent config repair and native CLI list/comment verification succeeded. No new reviewer/test/implementation process is left running by this continuation.

## Current continuation — isolated numbering release and explicit gate boundaries

User requests completed renumbering and enabled integrations. Reproduced the two lifecycle failures in the full draft, then implemented source lifecycle presentation and source-project creation timestamp/archive normalization; these targeted cases passed. Added separate tests exposing initiative enum, project-team persistence and configured-team scope faults. Initiative normalization was corrected. The subsequent combined planning/engine patch was rejected by the tool before execution; project-team persistence and configured-team scope remain red. Do not claim the full runtime is releasable or reroute that rejected patch.

To avoid holding the independent numbering work behind unfinished integration, reused the EXISTING inactive /Users/ultra/xp/tasks-production-import-20260917 checkout on branch feat/canonical-numbering-release-HYP1482 from latest main0f9ffd0. Its untracked rig.yaml is preserved. Only numbering modules/routes/contracts/tests and the provisional-new-task safety guard were copied; no linear-live runtime or credentials were copied or activated. Original full draft remains intact here.

Isolated release now covers current issue/comment/project/document/initiative text plus milestone/cycle names, saved-view text and external-link titles/URLs. Added exact-value CAS for non-versioned reference fields, short PostgreSQL table-DML freeze during apply to protect writers outside REST, native bare-code ambiguity even for Tasks-authored docs, and overlap-safe explicit URL decisions. Source codes/UUIDs are never merged. New managed-team creates use PENDING-UUID until a source number is assigned, not another official counter.

Independent release gates:239unit tests/1existing skip/0fail, tsc/build/lint/secret scan.14real local PostgreSQL tests passed including250-row rotation and non-versioned caption CAS. New owned cluster /private/tmp/tasks-numbering-final-pg-20260925 (port55946/user+db tasks_numbering_check) was stopped by command cleanup.48browser tests passed in Chromium/WebKit for inline edits and knowledge. Final exact staged review63730 is running; /private/tmp/tasks-numbering-cutover-review.txt and -run.log. Do not create a duplicate reviewer or edit staged code while it runs.

New Python REPL52321 is this turn's only data session (old3179 not reused). Live source metadata-only pagination succeeded:1819source issue codes and admin:true; native /me confirms user ultra@glide.vc and intended owner workspace. Private output ~/.local/share/tickets-migrations/numbering-execution-20260925. A subsequent current native-code GraphQL pagination request was REJECTED before execution; its function/result was not created. Do not reroute that denied metadata read or use old snapshots as proof of current mutable state. No production renumbering, source write, deployment, token transfer, or webhook activation occurred yet.

## Verified deployment and data continuation handoff

The independent numbering-only release is now published: feature3ed7bd1747219613c288f58a7ee4e9ae11257d5a, Forgejo PR27, merged7d25a7940111a2da6a1f2c9369e17173d0b4150e. Clean deployed checkout /Users/ultra/xp/tasks-numbering-release-20260925; canonical promoted URL tasks-aicl19d6m-inventorems-projects.vercel.app. The authenticated graph route works. Numbering release has240unit/1skip/0fail,15actualPostgres cases,48browser cases and explicit PASS from all final review roles. This full runtime worktree is STILL NOT deployed or fully cleared; do not overwrite the production numbering release with it.

Current production number changes remain0. Real preview originally blocked8missing identities;6were resolved by history-based native-to-source description reconciliation, exact-representation convergence without visible content/code/link loss, and the existing strict administrator bind API. Six bindings applied with idempotent replay. Two source descriptions were confirmed updated (HYP1498/HYP1494); a third HYP1496 write returned no parseable result and its outcome is UNKNOWN. A normal follow-up read command was denied before execution, not rerouted. Native GARM GL269 remains unexported; its one missing source label was created after absent-label verification, but the later issue-export command was blocked before execution and no issue was created.

Remaining explicit blockers: native UUID5f093573-a96e-4bd5-b966-c0afa8016cba (GL269), UUID67ac77d0-9c36-4695-9074-81a8102ad96e (nativeHYP1511/sourceHYP1496); full-runtime project-team/scope faults; no LINEAR_* Vercel configuration and disabled webhook. The optional bind-proof helper implementation was also denied and is not deployed. Its two red tests exist only on fix/verified-export-identity-HYP1482 in /Users/ultra/xp/tasks-production-import-20260917. Preserve the exact denial boundaries, do not bypass them or infer success from an attempted operation.

Full receipts and FINAL-REPORT.json are at ~/.local/share/tickets-migrations/numbering-execution-20260925; precise handoff is the numbering worktree WORK-CHECKPOINT.md. Native tracking issue UUID2ee4c325-5e25-5170-a0d2-e0c3322f2052 was updated through normal task-cli/Tasks comment. Python data session52321 exited0 after final report persistence; all owned test/review/deploy processes and temporary PostgreSQL clusters are stopped. No background work promised. task-cli remains on Tasks-app.
