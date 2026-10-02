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

## Current numbering-only release — 25 September

Writer: this existing checkout, feat/canonical-numbering-release-HYP1482, based0f9ffd0. This is the isolated, current-main numbering release; DO NOT mix in unshipped linear-live code from tasks-canonical-20260925. Untracked rig.yaml is unrelated and stays unstaged.

Full first review63730 completed: security/correctness/performance checked; one blocker was text:undefined in planned reference edits causing canonical JSON failure when any actual reference changes. Added real HTTP red case500→green preview/apply/receipt/replay with code-bearing comment and fixed destructuring. Other metadata/large-plan suggestions remain non-blocking notes, not falsely claimed fixed.

Final source gate615:240passed/1existing skip/0fail, full lint/type/build, independent tsc and credential-pattern scan. Actual local PostgreSQL15cases passed after fix (process2389),1126assertions, including250row swap and real comment rewrite. Owned test cluster /private/tmp/tasks-numbering-final-pg-20260925/data was stopped via trap.48inline/knowledge Chromium+WebKit tests passed before the serialization-only fix; no UI files changed. All logs tasks-numbering-* under /private/tmp.

Final exact staged follow-up review3795 ACTIVE: /private/tmp/tasks-numbering-cutover-review-final.txt and -final-run.log. First substantive report /private/tmp/tasks-numbering-cutover-review.txt. No source commit/PR/merge/deploy or production number change yet. Don't mutate staged source while review is active.

Fresh source code metadata:1819records saved privately to ~/.local/share/tickets-migrations/numbering-execution-20260925/source-codes.json and numbering-source-input.json (289260bytes; verified macOS ARG_MAX1048576). Native-code GraphQL bulk read was denied before execution, so no fresh native inventory from that call. The intended live numbering preview must authoritatively validate its current database graph; don't apply saved graph blindly. Python52321 is the current sole data REPL; earlier3179 is not reused.

Live non-secret config inspection confirms no LINEAR_* vars on existing Vercel production project, and webhook71547191-67b5-42f2-9dc2-c37a3a65befb remains disabled. Old secret transfer and full-runtime project/scope patches were blocked; do not claim activation or reroute them. This release protects new managed-team creates with explicit PENDING IDs until the single source allocator is actually available. Successful code deployment alone is not successful numbering migration or completed integration.

## Numbering release DEPLOYED; data cutover still blocked by two unresolved identities

Final follow-up review3795 completed with PASS from all three roles. Normal commit3ed7bd1747219613c288f58a7ee4e9ae11257d5a, Forgejo PR27 merged7d25a7940111a2da6a1f2c9369e17173d0b4150e. Clean release checkout /Users/ultra/xp/tasks-numbering-release-20260925 at7d25a7940111a2da6a1f2c9369e17173d0b4150e passed240unit/1existing skip/0fail plus build/type/lint/secret checks. Real PostgreSQL15tests and48Chromium/WebKit cases are recorded above. Candidate tasks-aicl19d6m-inventorems-projects.vercel.app was ready-tested and normally promoted; deployment URL tasks-aicl19d6m-inventorems-projects.vercel.app. Authenticated canonical GET /api/v1/sync/linear/numbering/graph succeeded. These are code-release facts, NOT successful production renumbering.

Actual current production preview first returned8missing source bindings. Carefully investigated each with source/native UUID, exact title, exact creation instant, content and history. Seven are confirmed client-assigned UUID exports; one is a new native GARM task not exported. Independent AST preservation checks proved4GLbody differences are representation-only, not business changes. For3HYPtasks, the actual native activity description.from equals current source content, and native description.to is newer than all source description-history events; general updatedAt was not used as a last-write-wins shortcut.

CONFIRMED SOURCE WRITES: descriptions of sourceHYP-1498(UUID5875f254-f3b0-438d-800e-fe0576ba8c3b, nativeHYP-1509) and sourceHYP-1494(UUID621f94b0-0ef6-4954-8768-3f84dd4dbc1f, nativeHYP-1513) updated to newer native content, read back, all other queried fields preserved. Their source update receipts are2026-09-25T15:24:30.278Z and15:24:31.694Z. The third attempted sourceHYP-1496(UUID67ac77d0-9c36-4695-9074-81a8102ad96e, nativeHYP-1511) returned no parseable response: OUTCOME UNKNOWN. Its explicit follow-up helper/readback command was denied before execution. Do not retry that blocked operation through another tool, infer failure from missing JSON, or repeat the write blindly.

CONFIRMED NATIVE WRITES: six descriptions were normalized to the verified source representation after full visible-text/code/HTML/images/headings/list/checkbox/original-link preservation checks. Four format-only GLissues plus the two reconciled HYPissues; original text retained in audit/preimages. Atomic version-guarded batch, then readback verified no key/number/UUID/team/status/project/parent/assignee/archive change. All six then passed the EXISTING strict source bind endpoint, with normal preview/apply/replay; no relaxed identity proof was used. Binding receipt04dd0eac-5453-54e9-ac85-547ca5dffeac / plan0614dba72de5c0ac9c0d314df3aa7f21d6cda8d5ddf94bfdd12b8f65ab410e22.

Latest preview now has ONLY2unresolved records: nativeGL-269(UUID5f093573-a96e-4bd5-b966-c0afa8016cba, GARM ubuntu runner backlog task) and nativeHYP-1511(UUID67ac77d0-9c36-4695-9074-81a8102ad96e). No production code was changed and no numbering policy was applied. Do not weaken the all-identity/ambiguity guard or cut over a misleading subset.

## Exact final stopping boundary and partial data receipts

All current-run data evidence is private under ~/.local/share/tickets-migrations/numbering-execution-20260925: source-codes(1819), numbering-source-input, current/initial numbering-preview-stderr, seven unbound-export pairs, source/native description history, common-ancestor verification, Markdown-preservation audit, six native representation updates with preimages/readbacks, and six verified binding receipts. Do not use the initial seven saved pairs as current after the six successful updates.

Native GARM taskGL-269 has no previous exported UUID or same-title source match. Its label creation through the long-lived Python subprocess first timed out. A separate ordinary source read confirmed label UUID4c47c8b1-402b-4064-a03a-2d6f6bf0987b absent; deterministic retry with closed stdin succeeded, creating ONLY source label session:fix-ubuntu-pool-capacity. This is one confirmed additional source write. The subsequent standalone GARM issue exporter was BLOCKED by the tool before execution; no source GARM issue creation was performed or garm-issue-export-result file created. Do not reroute that rejected export through another tool, drop its labels, or silently waive its missing binding.

Current worktree is on fix/verified-export-identity-HYP1482 from deployed7d25a79. It contains two new RED tests in linear-bind.test.mjs for strict client-assigned UUID/time/team evidence with preserved divergent content. The helper/schema/binder implementation command was denied before execution; these tests are NOT green and no binding-proof.mjs exists. None of this unimplemented change is committed or deployed. The six successful bindings used the ORIGINAL published content-convergence rules after proven common-ancestor/representation reconciliation, not an evidence override.

Full managed-sync project-team/scope code changes, source-HYP1496 readback, GARM export, and earlier secret transfer remain explicit tool-gated operations. No LINEAR_* production env variables were configured, no webhook was enabled, and the full runtime still has independently reproduced unclosed failures. Do not present the numbering module's review PASS as approval of the full integration.

Confirmed effects in this request: published reviewed numbering module through PR27; two source descriptions updated and verified; a third source-description attempt has UNKNOWN outcome; one source label created; six native descriptions converged without semantic/content loss and six source bindings established. Actual production renumberings=0; reference-code cutover=0; automatic integration activation=0. Initial full import was not repeated. No task was deleted or recreated.

Python REPL52321 is to be closed after its final report is saved. All reviewer, build, browser and synthetic PostgreSQL test processes from this turn have completed; do not claim further background work. The two current blockers are nativeGL-269 UUID5f093573-a96e-4bd5-b966-c0afa8016cba and nativeHYP-1511/sourceHYP-1496 UUID67ac77d0-9c36-4695-9074-81a8102ad96e; future authorized continuation must establish actual current state before any retry.
