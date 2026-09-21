# Tasks MCP release checkpoint — 21 September 2026

User request: create a ChatGPT connector for tasks-app and adapt the app as needed for the meeting workflow. All interfaces are English, no paid dependency added.

Base: 501cce5568ec1137458bb012fe968150fe21583f. Isolated writer: /Users/ultra/xp/tasks-app/.worktrees/chatgpt-connector-20260921. Existing dirty worktrees were preserved.

## Completed source and verification

- OAuth authorization code with S256 PKCE, exact callback registration, existing-session consent, CSRF, resource-bound access tokens, rotating refresh tokens and revocation.
- Streamable HTTP MCP tools search/fetch/catalog/create_issue/update_issue/add_comment use existing workspace domain authorization, idempotency and version conflicts.
- Portable plugin package: plugins/tasks.
- Final source check passed190 unit tests (one PostgreSQL-only test skipped in SQLite) after the independent security fixes, Oxc lint/typecheck/build, independent TypeScript and secret-pattern scan.
- Chromium73 and WebKit73 browser cases passed. They were run with fresh isolated test servers because running both against one long-lived fixture exhausted its login rate limit; no rate limit was weakened.
- Synthetic Chromium consent journey passed: sign-in prompt, existing session consent, callback code+issuer; screenshot /tmp/tasks-mcp-consent.png.
- Final targeted PostgreSQL connector acceptance passed5 tests/70 assertions in54.17s: /tmp/tasks-mcp-pg-reviewed.log. This includes deterministic refresh/revoke and refresh/Settings-delete interleaves, spent-refresh replay invalidating the successor, bare GraphQL OAuth audience rejection, idempotent issue/comment writes, scopes, PKCE and CSRF.
- An optional broader PostgreSQL run hit a network timeout and was stopped. It is not claimed green.

Independent delegated security review passed after fixing three findings: bare-token GraphQL audience bypass, concurrent revoke/refresh resurrection, and missing refresh-family replay revocation. The final design preserves the Settings token ID, locks the parent token before the grant, consumes refresh by checked compare-and-swap, and commits family revocation on detected replay.

The exact reviewed source hashes are retained in the independent reviewer handoff.

## Release boundary

Schema8 is additive only. A private pg_dump backup succeeded before migration (6,125,768bytes, TLS verification,0600); its protected path is maintained in the operator handoff, not published here. No task/account reset is permitted.

The regular review CLI stalled without output; independent review is complete but the existing global review-before-commit hook still applies. Do not manufacture a review stamp or bypass hooks. Publication, migration and production MCP verification must be recorded below once actually complete. A deployed endpoint is not a completed ChatGPT account connection; that requires the account's own OAuth consent and available MCP connection UI.
