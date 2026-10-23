# Sign in with Slack (HYP-1482)

Members can sign in with their Slack account next to the email + password form. The password login is unchanged.

## Decision: native Slack OpenID Connect

The app had no OAuth/OIDC login. Slack's OIDC authorization-code flow (`openid email profile`) needs about 150 lines and no new table, so it is used instead of a Slack-DM confirmation flow (which would need `im:write`, an interactivity endpoint and a pending-approval table). Nothing is cached beyond the ordinary session.

## Flow

1. `GET /api/auth/slack/start` redirects to `https://slack.com/openid/connect/authorize` with `team=<SLACK_TEAM_ID>`, `state`, `nonce`, `redirect_uri=<APP_URL>/api/auth/slack/callback`. It sets the HttpOnly `tickets_slack_oauth` cookie (`SameSite=Lax; Path=/api/auth/slack; Max-Age=600; Secure` in production) holding `state.nonce.expiry.HMAC(AUTH_SECRET)`.
2. Slack redirects the browser to `GET /api/auth/slack/callback?code&state`. The server checks the cookie signature, expiry and that its state equals the returned `state`, then trades the code at `https://slack.com/api/openid.connect.token` (server to server, TLS) with the client secret.
3. The returned `id_token` is decoded (no signature check is needed for a token received directly from the token endpoint over TLS, OIDC Core 3.1.3.7) and must have `iss=https://slack.com`, `aud=SLACK_CLIENT_ID`, an unexpired `exp`, the stored `nonce`, `https://slack.com/team_id == SLACK_TEAM_ID`, and a verified `email` (`email_verified` must be exactly `true`).
4. The email must belong to an existing `users` row with a membership (in `INTEGRATIONS_WORKSPACE_ID` when set). Otherwise nothing is created and the browser returns to `/?slack_signin=not_a_member`. **Login never creates accounts or memberships.**
5. A session is created with the same code as the password login (`startSession`): random 256-bit token, only its SHA-256 stored, 7 days, `HttpOnly; SameSite=Lax; Path=/` cookie. The state cookie is cleared on every callback. The browser is redirected to `/`.

Every failure, including unexpected server errors (`failed`), redirects to `/?slack_signin=<lowercase error code>`; the login page shows a fixed message per known code and a generic one otherwise, and the query is removed from the address bar after it is read. Two tabs signing in at once share one state cookie: the older attempt fails and can be repeated. Tokens, codes and secrets never appear in a redirect, log or response.

## Security notes

- **CSRF / login CSRF:** the state is bound to the browser by the signed cookie; a foreign, forged, swapped, expired or missing state is refused before Slack is called. The two endpoints are GET navigations and change no existing data; the CSRF header and origin check of mutating API calls are unchanged.
- **Replay:** Slack authorization codes are single use; a replayed callback gets `slack_code_rejected`. The state cookie is cleared and expires after 10 minutes. The nonce is checked in the id_token.
- **Team confinement:** `team=` on the authorize URL plus a server-side team claim check; a member of another Slack workspace cannot sign in even with a matching email.
- **Rate limits:** only `slack-signin-email:<hash>` (12 per 15 minutes, existing `auth_attempts` limiter), charged after Slack accepted the code. There is deliberately no per-source limiter: on the self-hosted server every visitor shares one source key (as for password login) and `/start` mints valid state for free, so a source limiter would let any anonymous client lock everyone out. A junk callback costs one HMAC; a valid-state callback with a bad code costs one Slack token-endpoint call (bounded by Slack's own limits). A Slack user can exhaust only their own email's bucket.
- **Email trust:** Slack verifies workspace emails; `email_verified: false` or a missing email is refused. Treat the Slack workspace admin as able to sign in as any member whose email they can set.
- **Revocation:** removing a member or changing a password revokes sessions exactly as before; Slack sessions are ordinary sessions.

## Operator configuration

Environment (credentials file on bread, never git): `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID`, optionally `INTEGRATIONS_WORKSPACE_ID`. The option appears on the login page (`/api/auth/options` → `slackSignIn: true`) only when the three are set.

Slack app (api.slack.com/apps → OAuth & Permissions):

- Redirect URL: `<APP_URL>/api/auth/slack/callback` (for production `https://tasks.glide.vc/api/auth/slack/callback`).
- User token scopes for sign-in: `openid`, `email`, `profile` (Slack adds them for "Sign in with Slack").
- Bot scopes for the rest of the Slack module: `chat:write`, `users:read` (and `users:read.email` only if an operator tool lists members by email; the app itself never reads emails with the bot token).
- Command and shortcut Request URL (existing): `<APP_URL>/api/webhooks/slack`.

## Tests

`tests/unit/slack-signin.test.mjs`: option gating, authorize URL and cookie flags, full sign-in and session use, hashed storage, replay, non-member, other workspace, wrong team/audience/expiry/nonce/unverified email, state missing/foreign/tampered/expired, denial, Slack outage, rate limit, password login unaffected, secret not leaked.

## Adding members from Slack (operator tool)

`scripts/slack-members.mjs` (`tasks-slack-members` on bread) lists the Slack workspace with the bot token and adds its humans as Tasks members through the app's own services: `invite` + `acceptInvite` for each missing email (role `member`, a random password nobody knows, so the person signs in with Slack or after a password reset), `setIntegrationConfig` for the `user_map` (Slack ID to member, existing mappings are kept) and `syncSlackProfiles` for Slack names and photos. Existing members are never modified, so the owner keeps the `owner` role.

- Dry run by default: prints counts (humans, bots, deactivated, no email, other team), guests skipped and the emails it would create. `--apply` writes. `--role admin|viewer` and `--include-guests` are opt-in.
- It needs `SLACK_BOT_TOKEN` with `users:read` **and** `users:read.email` (the app itself never reads Slack emails), `SLACK_TEAM_ID`, `INTEGRATIONS_WORKSPACE_ID`, `DATABASE_URL`.
- Output carries emails and counts, never tokens.
- The Slack mapping keeps at most 100 entries (the Settings schema limit); further members are still created and counted in `unmapped`. A failed profile sync is reported as `sync.error` (exit code 1) and never discards the report of the accounts already created.
- Covered by `tests/unit/slack-members.test.mjs`.
