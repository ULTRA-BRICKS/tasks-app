# ChatGPT connector

The Tasks connector uses the existing workspace identity and task services. Public source and OAuth discovery never make workspace data public.

## Connect

The existing canonical OAuth MCP endpoint is `https://tasks-ultrabricks.vercel.app/api/mcp`.

1. Open ChatGPT **Plugins** → **plus** → **Add custom MCP server**.
2. Name the connection Tasks, enter the canonical endpoint and choose OAuth/dynamic client registration.
3. Complete Tasks sign-in and consent, review the risk warning, and select **Create as a plugin**.
4. Install the resulting personal plugin with **plus**.
5. Open a new **Work** chat and invoke `@Tasks`.

The stable exact callback is `https://chatgpt.com/connector_platform_oauth_redirect`. The live DCR server advertises issuer identification and returns the issuer in authorization responses. Keep the existing callback allowlist and authentication semantics; do not enable anonymous access or invent a registered app ID. Documentation alone does not install the plugin or activate a user's account. Public directory publication is a separate process.

Sources: [OpenAI quickstart](https://developers.openai.com/plugins/quickstart), [plugin packaging](https://developers.openai.com/plugins/build/plugins).

Sign in to Tasks in the same browser and explicitly approve the requested read/write scopes. A viewer can connect read-only. Each member connects their own identity. The connector cannot grant administrator permissions, manage membership, or delete issues.

The connector exposes search, fetch, catalog, create_issue, update_issue and add_comment. New issues and comments require caller-supplied idempotency keys. Updates require the current version, preserving optimistic conflict detection. Catalog returns workspace members only; imported source identities are not treated as assignable members.

## Authentication and revocation

OAuth authorization codes expire after five minutes and require S256 PKCE. Codes are consumed transactionally once. Opaque access tokens expire after one hour, are stored only as hashes, and are bound to the MCP resource through their grant. Refresh tokens rotate on every use and expire after 30 days; the original expiry does not slide. Reusing a spent refresh token revokes the entire connection, including its active successor. The token ID shown in Settings remains stable across rotations. Revocation removes the grant and API token. Removing the corresponding ChatGPT connector token in Tasks token settings also revokes refresh access. Membership and role permissions are checked on every request.

Existing personal API tokens and browser cookies are not accepted at the MCP endpoint. The meeting service uses its own read/write personal token directly with the REST API; do not share a browser session or copy a connector OAuth token into service configuration.

The stateless Streamable HTTP endpoint supports JSON responses and does not offer a persistent SSE stream. No third-party paid OAuth service, model provider, or package is required. A ChatGPT plan/workspace must independently support custom MCP connections; deploying this endpoint does not install or enable a connector in someone's ChatGPT account.

## Meeting service REST contract

- GET /api/v1/catalog returns teams, people (id, name, email, role), statuses and labels.
- GET /api/v1/issues?q=words&team_id=UUID&limit=50&cursor=... returns data and next_cursor.
- GET /api/v1/issues/KEY returns the task, current version and associated details.
- POST /api/v1/issues accepts title, team_id, description, assignee_id, due_date, project_id and other documented issue fields. Include the meeting link, transcript timestamp/quote and decision provenance in description.
- PATCH /api/v1/issues/KEY requires version and requested changes.
- POST /api/v1/issues/KEY/comments accepts body.
- Creation and comments support Idempotency-Key. Use a stable value such as meeting:EVENT_ID:action:ACTION_ID, at most 160 characters containing letters, digits, underscore, dot, colon, slash or hyphen. Keys are scoped to workspace and authenticated user. Reusing a key with different content returns 409.

Resolve assignee IDs from catalog.people email, not imported source_people. Preserve a local meeting-action-to-issue mapping and search before creating. Do not create commitments from an ambiguous transcript without participant confirmation.

## Release

Use the existing Forgejo/Vercel release workflow in OPERATIONS.md. Migration 8 adds only mcp_oauth_codes, mcp_oauth_grants and spent-refresh history; it does not modify tasks, memberships or existing credentials. It must be explicitly applied before deploying code that expects schema 8. Builds and requests never migrate automatically in production. Do not promote while canonical schema readiness is unverified.

APP_URL must remain the canonical HTTPS origin. AUTH_SECRET is required for signing registered client identities; rotation invalidates existing client IDs and requires reconnecting. MCP_REDIRECT_URIS is optional and must contain exact HTTPS callbacks. The endpoint intentionally has no global service account or bypass token.

Validation includes OAuth grant/code/refresh replay, PKCE mismatch, callback/resource/CSRF rejection, anonymous denial, read-only scope and role downgrade, create/comment deduplication, and optimistic update conflicts. Local fixtures do not establish a live ChatGPT connection.

Sources: https://developers.openai.com/plugins/build/auth and https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization .
