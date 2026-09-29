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

## Remaining wording rules (UB-35, 2026-09-29)

Scope: the last user-visible places that still said "issue" after the route/navigation rename. The rule is presentation-only: people read Task/Tasks; machines keep the Linear-compatible names.

Rules:

- Human-readable text rendered by the web app says task/tasks: task history summaries (including history rows written before this change, because summaries are rendered at read time), settings module names and descriptions, browser-facing HTML metadata, the task "Copy prompt" format, and REST error messages that the app shows in error states and toasts (not found, self-parent, self-link, delete-with-sub-tasks, deleted-task edits, team deletion).
- Unchanged contracts: `/api/v1/issues` routes, request/response fields, `kind: 'issue'` values, `error.code` values (`NOT_FOUND`, `SELF_PARENT`, …), database tables/columns, stored activity action codes and imported payloads, the module id `tickets`, CSS/test hooks, query keys and the CLI's `tickets issues …` protocol.
- `/graphql` keeps Linear vocabulary. A missing `Issue` keeps its GraphQL-type message (`Issue not found`, `extensions.code: NOT_FOUND`), consistent with the other GraphQL entities (`IssueRelation not found`, `Comment not found`). REST and the app say `Task not found` for the same lookup. Other domain validation text is product prose shared by both transports; its `extensions.code` and envelope are unchanged.
- Third-party product nouns stay qualified: "GitHub issues", "Linear issue URL", Linear import/sync diagnostics that describe source-side records.
- The legacy search alias stays: typing "issue" in the command menu still finds task actions.

Acceptance → tests:

- History: every native action code and every imported-change flag renders a summary with no standalone "issue" (tests/unit/activity-presentation.test.mjs); imported history in the browser shows task wording on desktop and phone widths (tests/e2e/imported-history.spec.ts).
- 404: REST `GET /api/v1/issues/<missing>` returns `Task not found` with code `NOT_FOUND`; GraphQL `issue(id)` for the same key returns `Issue not found` with the same code (tests/unit/linear.test.mjs); the app's task error state shows `Task not found` (tests/e2e/task-url-aliases.spec.ts).
- 404 layout (follow-up): the shared error state puts Retry under the message, left-aligned with the text; at phone widths (≤767px) Retry spans the card and is at least the 44px tap target (tests/e2e/task-url-aliases.spec.ts, desktop 1440 and phone 390 in Chromium and WebKit). Retry uses the small secondary button instead of ghost, so every retryable error state (task load, session bootstrap, invitations, workspace policy, planning documents) shows a visible button. A full-width ghost button read as floating text on phones. Rejected: a task-only 404 component, because every retryable error state had the same side-column Retry.
- Settings: the modules catalog names the core module Tasks and describes it with task wording (tests/unit/core.test.mjs; visual proof).
- HTML: the meta description uses task wording; the `<title>` stays the `tasks-app` brand pinned by tests/unit/product-identity.test.mjs.
- Copy prompt: "Copy prompt" on a task produces "Help me work on this task." (tests/e2e/overflow-actions.spec.ts).

Decisions and rejected alternatives:

- Rejected: renaming stored activity actions or rewriting imported history. The server renders labels from immutable action codes at read time, so old rows pick up the new wording without a data migration.
- Rejected: changing GraphQL not-found text to "Task". GraphQL clients address `Issue`; the other GraphQL not-found messages use type names too.
- Rejected: renaming the `<title>` brand. It carries no issue wording and is pinned as the product identity.

Out of scope: Storybook fixture copy ("Create issue" buttons in primitives stories), demo seed titles that describe issue-tracking as a subject, MCP/CLI protocol names, Linear sync diagnostics, the OpenAPI document and the pinned Linear GraphQL schema descriptions.
