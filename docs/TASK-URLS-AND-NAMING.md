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
