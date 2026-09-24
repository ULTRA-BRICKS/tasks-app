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

The initial review CLI calls blocked while reading Remote Desktop Commander stdin until EOF. Running the ordinary review with explicit stdin EOF fixed the interruption: append `< /dev/null` to noninteractive review commands. Three regular reviewer roles then completed, and the normal commit/push hooks accepted the reviewed change. No hook, stamp, quota or approval policy was bypassed.

## Live release

Code PR: https://git.hyperide.ai/ultrabricks/tasks-app/pulls/14 (merged).
Deployed source: main commit5171b08.
Canonical MCP endpoint: https://tasks-ultrabricks.vercel.app/api/mcp .
Deployment: https://tasks-7lgm1775j-inventorems-projects.vercel.app .
Deployment identifier: dpl_2JB68g9X29iQUDzHrXzqrN2Zkefc.

Explicit production migration returned applied=true,version=8 after a verified private backup. Before/after task, account and membership counts were unchanged. Candidate readiness and metadata passed before promotion; the canonical service passed the following checks after promotion:

| Check | HTTP | Result |
|---|---:|---|
| schema ready | 200 | Passed |
| resource metadata is JSON | 200 | Passed |
| issuer discovery and PKCE | 200 | Passed |
| anonymous MCP denied with OAuth challenge | 401 | Passed |
| invalid access token denied | 401 | Passed |
| private REST remains anonymous denied | 401 | Passed |
| bare OAuth token cannot bypass MCP audience through GraphQL | 401 | Passed |
| exact ChatGPT DCR callback accepted | 201 | Passed |
| consent requires existing sign-in | 200 | Passed |
| invalid authorization code rejected | 400 | Passed |
| unregistered callback denied | 400 | Passed |

Verified at 2026-09-21T11:24:42.944Z. Both discovery responses are actual JSON, not the SPA fallback.

A live authenticated ChatGPT account connection has **not** been claimed: register the endpoint in the account's MCP connection UI and complete its OAuth consent. Live protocol checks did not create a task, comment, membership or user grant. Authenticated task tools and gated writes were exercised through isolated SQLite/PostgreSQL fixtures and the local consent browser journey.

Remaining nonblocking maintenance observations from review: the connector deliberately rechecks domain authorization when forwarding tool calls; fetch response duplication and expired-grant history cleanup can be optimized separately without changing access controls.
