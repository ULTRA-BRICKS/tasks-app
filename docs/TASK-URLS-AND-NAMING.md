# Task URLs and product terminology — implementation plan

Goal: open Tasks by immutable UUID or the existing workspace-scoped task code, with an optional decorative slug, while keeping published /issues links and the compatibility API working.

Spec: user feedback item feedback-20260925-13, current Tasks record918fee26-649a-4b07-9755-45fd1d3c1283 (currently UB-37); terminology feedback item14. Codes must be re-resolved before tracker writes because another agent owns numbering.

Architecture: frontend routes normalize only the address format. Existing getIssue already resolves UUID/code with workspace scoping; no database renumbering, identity migration or new lookup precedence is added. Canonical UI routes are /tasks and /my-tasks. Legacy /issues and /my-issues redirect with replace, preserving query/hash/history state. Optional stale slugs never become identity keys.

Files: src/shared/lib/task-reference.ts (pure bounded parser), src/pages/issues/route.tsx (route guard/legacy redirect), app routes, existing frontend navigation/copy labels, public worker route allowlist. Public /api/v1/issues and Linear GraphQL Issue names remain unchanged.

- [x] Write and run red browser checks: current /tasks paths fail to load and names remain Issues.
- [x] Implement bounded UUID/code parsing; add pure tests for stale/Unicode slugs and malformed identifiers.
- [x] Wire canonical and legacy routes with preserved query/hash; keep invalid references on a not-found screen rather than accidentally navigating to another API.
- [x] Update human-visible Issue/Issues labels and navigation paths without touching database identifiers, CSS/test hooks, query keys, imported content or API routes.
- [x] Verify UUID/code/slug/legacy against the same real synthetic record and count zero writes while opening links.
- [x] Verify existing data editing, Back/close behavior and native drafts through the whole browser suite.
- [ ] Inspect intentional visual text changes, run Storybook/types/unit/build, complete ordinary review and publish clean merged source.

Review focus: double-decoding path segments; preserving stale slugs and query/hash; ambiguous historical codes remain the backend's responsibility; modifying a query/API identifier during terminology cleanup; existing external links remain valid. Private-cache and keyboard work are separate and not declared complete by this increment.

## Implementation verification

UUID/code and slash/hyphen slug routes now pass10targeted Chromium/WebKit cases. Task content, API paths, database identity and account permissions are unchanged. Legacy routes preserve query/hash/state; old issue search wording still finds renamed task actions. A discovered code-alias comment-refresh issue was reproduced and fixed by invalidating only loaded detail queries whose immutable returned ID matches the updated task. The sharper test verifies a posted comment article after the prior save fully settled. An additional isolated unit-test file was denied before creation; it is not claimed as coverage.

The first full-source check passed247unit/1pre-existing skip. A browser pass encountered an unrelated document reload while ephemeral account-link state was in memory; trace shows a second Vite connection. This run is not counted green. Full verification will be rerun with absolutely no source or documentation writes while the browser server is active. The reference-language changes intentionally update text assertions, not API payloads or imported source content.

## Review and release evidence

The completed whole-app runs passed107 Chromium and107 WebKit scenarios,247unit/1pre-existing skip,21Storybook and independent types/build. Review caught an incorrectly renamed deterministic import-test namespace and CLI examples; both were restored to the unchanged issues protocol. The imported-history regression now passes without modifying source identities. Copy grammar was corrected, and the unused slug capture made noncapturing without changing accepted characters. Current supported team keys are2–10alphanumeric characters, matching Team schema validation.

Two native-resolution list snapshots were inspected alongside their pixel diffs. Expected Task/Tasks title/search/navigation wording changed. The only additional differences are the inherited two-initial avatar rendering already shipped in the people release; this branch has no avatar-code diff. Layout, group spacing and control positions are retained. Only these two inspected baselines were accepted, without changing thresholds. This is product regression verification, not a90%Linear-fidelity measurement.

## Historical pre-canonical codes (UB-37 remainder, 29 September 2026)

Rule, quoted from docs/LINEAR-CANONICAL-PLAN.md L16: "Ruling: current bare codes resolve to canonical tasks after cutover. Old conflicting codes require an explicit origin-qualified historical lookup; aliases must never silently redirect to the wrong current task." L8 adds: "Preserve original keys and content in a durable origin-scoped migration receipt. Reject stale/partial inputs. Never implement ambiguous bare legacy redirects." Ticket criterion: "Ambiguous or reassigned historical codes never choose the first record; respect canonical numbering provenance."

Storage (confirmed in code and tests, no new table or migration): canonical renumbering writes, in the same transaction as the code changes, one outbox row per migration with provider `linear-numbering`, event `canonical-migration`, status `state` (packages/server/modules/linear-numbering/service.mjs L310-325). Its JSON payload `pairs` lists every mapped task as `{id, sourceId, oldCode, newCode, oldNumber, newNumber, teamId, version}` (L187-196), including codes the migration kept. Nothing deletes `state` rows; workers only claim pending/processing rows. `module_settings` keeps only the latest migration ID, so the lookup reads every receipt rather than that setting.

Scope:

- Origin-qualified route `/tasks/pre-canonical/<CODE>` (optional decorative slug as on task routes; legacy `/issues/pre-canonical/...` goes through the existing redirect). `pre-canonical` means "the Tasks code this task had before a Linear canonical renumbering". It cannot collide with a task reference: codes need digits after the hyphen and UUIDs are never renumbered.
- REST `GET /api/v1/issues/pre-canonical/{code}` through the normal read authorization and a workspace-scoped read transaction. `/graphql` is unchanged: Linear has no such field and the endpoint is a Tasks-specific feature.
- Resolution: read this workspace's receipts newest first; a match is a pair whose `oldCode` equals the requested code. Matches group by task UUID, ordered by their newest receipt. Each match carries the task's code chain from that receipt through every later receipt (`from`, `to`, `migration_id`, `at`) and the task as it is now (UUID, code, title, status). A deleted or missing task keeps its chain with `task: null` and no link. `ambiguous` is true when more than one task held the code; the page then lists them all and never picks one. The task that holds the bare code today comes back separately as `current`, for context only.
- Bare codes are unchanged: `/tasks/<CODE>` and `/api/v1/issues/<CODE>` still open the current holder.
- Errors: malformed or unknown codes return 404 `NOT_FOUND` "No task had this code before canonical renumbering". Unauthenticated requests get 401. Another workspace's receipts are never read. An unreadable receipt fails the lookup (500 `INVALID_NUMBERING_RECEIPT`) instead of returning a chain that might silently miss a task.
- Page: a compact read-only page in the workspace shell. The toolbar has the mobile navigation button and the heading "Pre-canonical <CODE>". There is one row per task: status icon, current code, title and chain (for example "UB-27 → UB-29 · Sep 25, 2026"), linking to `/tasks/<uuid>`. For ambiguous codes, a line says how many tasks used the code. A note names and links the task that has the bare code today. The not-found state offers "Open current <CODE>" and "Back to tasks". Opening the page makes zero writes.

Acceptance → tests:

1. The receipt carries the pairs, and an old code resolves to the renumbered task while the bare code opens the current holder → tests/unit/task-code-history.test.mjs (real HTTP import plus canonical numbering), e2e task-url-aliases.spec.ts.
2. A code reused across two renumberings lists both tasks, newest first, with full chains → task-code-history.test.mjs; e2e.
3. Workspace isolation: another workspace's receipt with the same code never resolves or adds matches → task-code-history.test.mjs.
4. Unknown or malformed code → 404 with Tasks wording; anonymous → 401; deleted task → `task: null` with the chain kept → task-code-history.test.mjs; UI not-found state → e2e.
5. The client parser accepts codes (case-insensitive, optional slug) and rejects UUIDs, traversal and malformed segments → tests/unit/task-reference.test.ts.
6. Opening historical links makes no writes; the link opens the right task and Back returns → e2e.
7. Visual: desktop 1440×900 Chromium, phone 390×844 Chromium and WebKit, 320 px, for single, ambiguous and not-found states.

Rejected alternatives: a new `issue_key_history` table plus production migration and backfill. It duplicates the same-transaction receipts, needs operator approval and would add a second source of truth (decision quorum, .tasks-work-evidence/decisions-20260929/UB-37-quorum.md). Automatic redirect on a single match: it hides the provenance, since the user would land on a task showing a different code with no explanation. The page costs one click and shows the chain. Falling back from a bare code to history: this violates L16. A `?origin=` query flag on `/tasks/<code>`: it is easy to lose when links are unfurled or copied, and it overloads the current-holder route.

Out of scope: code changes outside canonical-migration receipts (live sync assigns final codes only to `PENDING-<uuid>` keys, which embed the UUID), command-menu or search integration, a "formerly" notice on the task page, and caching. Lookups are rare and human-initiated, and each receipt is bounded to 10,000 records. Known cost: `outbox` has no index on `(workspace_id, provider, event)`. The receipt query can use only the `outbox_pending(status, …)` prefix, so it filters through every `status='state'` row in the database, including other workspaces' live-sync entity state; only this workspace's receipts are returned. Each receipt payload is parsed whole to read `pairs`. That is acceptable for rare lookups. An index or projection would need a production migration with operator approval, so it is a separate follow-up, not part of this change. After loading, the resolver makes two linear passes over the receipt pairs and builds steps only for tasks that held the code.
