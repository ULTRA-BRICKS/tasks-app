# Slack names and photos — profile sync (UB-34)

Task identity: `43ff0ad8-cefd-4283-ada8-e53e2903a337` (currently UB-34). Tasks shows a person's Slack name and photo wherever it shows that person, once an administrator has mapped their Slack account. The display rules come from [PEOPLE-IDENTITY.md](PEOPLE-IDENTITY.md) (UB-29): a bound Slack profile gives its identity the name and the photo. This increment adds the writer of those Slack profiles and lets a mapping name an imported person as well as a member.

## Decision: users:read and explicit mappings (variant B)

The operator chose variant B on 29 September 2026 (evidence outside Git: `~/xp/.tasks-work-evidence/decisions-20260929/UB-34.html`, `UB-34-quorum.md`, `UB-34-quorum-r2.md`).

- The Slack app has the bot scopes `chat:write` and `users:read`. It does not have `users:read.email`. Tasks never reads, requests or stores Slack email addresses. If Slack sends `profile.email` anyway, the sync ignores it.
- Every link between a Slack account and a person is explicit and is written by an administrator in the Slack module settings. Names and photos are never evidence.
- The operator installs the app and sets the environment. Agents cannot do either. The code works the moment the environment exists.

## Mappings

The Slack module configuration (`PATCH /api/v1/integrations/slack`, administrators only) has two maps, both keyed by Slack user ID:

- `user_map` → a Tasks member ID. This is unchanged: the member can also create tasks from Slack commands.
- `source_person_map` → an imported (non-Slack) source person ID, for example a Linear author without a Tasks account. This gives about ten Linear-only people their Slack photo. A mapping to an imported person grants nothing: Slack commands from that Slack user are still refused with `USER_NOT_MAPPED`, because no member stands behind them.

Saving refuses, with 422:

| Case                                                                          | Code                    |
| ----------------------------------------------------------------------------- | ----------------------- |
| `user_map` value that is not a member of this workspace (existing check)      | `INVALID_MEMBER`        |
| `source_person_map` value that does not exist or belongs to another workspace | `INVALID_SOURCE_PERSON` |
| `source_person_map` value that is itself a Slack profile                      | `INVALID_SOURCE_PERSON` |
| `source_person_map` value that is a bot (provider flag or Linear app address) | `BOT_MAPPING`           |
| One Slack user ID in both maps                                                | `AMBIGUOUS_MAPPING`     |
| Two Slack user IDs mapped to one imported person                              | `AMBIGUOUS_MAPPING`     |

Two Slack user IDs may still map to one member, as before, so both Slack accounts can run commands. When both Slack profiles exist, the projection binds neither of them to the member and reports `conflicting_binding`: the member is marked for review and each Slack profile stays its own entry, because one person cannot show two Slack names and photos.

The projection turns a `source_person_map` entry into the binding `{ person_id, source_person_id, via: 'slack_source_person_map' }` under the same conditions as a `user_map` entry: the module is enabled, the target is a current imported non-Slack person, and exactly one Slack profile of the workspace carries the Slack user ID. The catalog's `identity_bindings` therefore holds two shapes: `{ member_id, source_person_id, via: 'slack_user_map' }` (unchanged) and the new one. A Slack profile bound to two targets binds to neither (`conflicting_binding`); a binding whose target has the Slack profile's own provider, is a member, or is unknown is `unresolved_binding`; a bot on either side is `bot_binding`.

## Sync flow

`POST /api/v1/integrations/slack/profiles/sync` runs one sync. It is the only writer. Nothing syncs at request time, on a timer or on catalog reads.

1. **Authorize (read transaction, which does not take the workspace lock).** The caller needs the `admin` permission, the same as every other integration setting. The Slack module must be enabled (`409 MODULE_DISABLED`). `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` and `INTEGRATIONS_WORKSPACE_ID` must be set (`503 SLACK_NOT_CONFIGURED`), and the caller's workspace must be `INTEGRATIONS_WORKSPACE_ID` (`403 WORKSPACE_NOT_CONFIGURED`). A rate-limit pause recorded by an earlier sync that has not yet ended is refused with `429 SLACK_RATE_LIMITED` without calling Slack. With no mapped Slack user, the sync returns zero counts without calling Slack.
2. **Read Slack (no transaction).** `GET https://slack.com/api/users.list?limit=200[&cursor=…]` with `Authorization: Bearer <SLACK_BOT_TOKEN>` and a 10-second timeout per page. The sync follows `response_metadata.next_cursor` until the cursor is empty or every mapped user has been seen, at most 50 pages. A repeated cursor, a cursor that is not a string, or page 51 is `502 SLACK_REQUEST_FAILED`.
3. **Write (one write transaction under the workspace lock).** The transaction re-authorizes and re-reads the mappings, so a mapping removed during step 2 is not written. A mapping saved during step 2 was not read from Slack, so it is neither written nor counted; the next sync picks it up. For each mapped Slack user seen in step 2:
   - `team_id` must equal `SLACK_TEAM_ID`. A user from another Slack workspace is rejected: nothing is written for it and it is listed under `cross_workspace`.
   - The source ID is `<SLACK_TEAM_ID>:<Slack user ID>` (the UB-29 convention). The row is `source_people(provider='slack', source_id, name, avatar_url)`. It never gets an email.
   - **Name**: trimmed `profile.display_name`, else `profile.real_name`, else the top-level `real_name`, else the mapped member's or person's current name; at most 200 characters.
   - **Photo**: `profile.image_192` exactly as Slack returned it, when it is an `https://` URL of at most 2,048 characters; otherwise none. Tasks never builds photo URLs.
   - **Deactivated** users (`deleted: true`) keep their row and are flagged `deactivated`. **Bots** (`is_bot: true`, and Slackbot `USLACKBOT`) are flagged `bot`, so the projection keeps them apart and refuses to bind them.
   - A row is inserted, updated when its name or photo changed, or left alone. Running the sync twice with the same Slack data changes nothing the second time.
   - Mapped users that Slack did not return are listed under `not_found`. Unmapped Slack users are neither stored nor counted: paging stops once every mapped user has been seen, so a count of them would depend on Slack's page order.

Slack rows are never deleted, because tasks, comments and activity may reference them. When an administrator removes a mapping, the stored profile stays but no longer binds, so it shows as its own person until it is mapped again.

The response and the Settings summary report `mapped`, `created`, `updated`, `unchanged`, `deactivated`, `bots`, `cross_workspace` and `not_found` (the last two also as Slack user ID lists) plus `synced_at`. Two syncs started at once both read Slack, but their writes run one after the other under the workspace lock; the second re-reads the stored rows and changes only what still differs.

### Stored flags and audit trail — no migration

`source_people` already has every profile column (`name`, `avatar_url`, `provider`, `source_id`). It has no column for the bot or deactivated flags. They are kept, with the audit trail, in a private settings row `module_settings(module='slack-profiles')`, following the `linear-numbering` precedent. That row is not a module: it is not listed, cannot be toggled, and administrators cannot overwrite it through the Slack configuration endpoint. It contains:

- `profiles`: `{ "<team>:<user>": { "bot": true, "deactivated": true } }`, only the flags that are set.
- `runs`: the last 20 sync attempts, newest first: `{ at, actor_id, outcome, counts? }`. `outcome` is `ok` or the error code. Failed Slack reads are recorded too, in their own transaction. A request refused during a pause never called Slack, so it is not recorded.
- `paused_until`: the end of a Slack rate-limit pause, or absent. A refused request never extends it, a later Slack 429 never shortens it, and a sync that succeeds while another sync recorded a pause keeps that pause.

The catalog reads the flags when it loads source people: `bot` is set on the source person, as UB-29 already expected from a provider sync.

## Errors

Every failure uses the normal error envelope with a machine code and a person-facing message. None contains the token, an authorization header or a Slack response body.

| Slack result                                                                       | Tasks response                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_scope`                                                                    | `502 SLACK_MISSING_SCOPE`, `details.needed` = Slack's scope list (`users:read`)                                                               |
| `invalid_auth`, `not_authed`, `account_inactive`, `token_revoked`, `token_expired` | `502 SLACK_AUTH_FAILED`                                                                                                                       |
| HTTP 429 or `ratelimited`                                                          | `429 SLACK_RATE_LIMITED`, `details.retry_after` seconds from `Retry-After` (60 when absent, at most 3600); later syncs are refused until then |
| any other `ok: false`, or a malformed body                                         | `502 SLACK_REQUEST_FAILED`, `details.slack_error` when Slack gave a plain error code                                                          |
| network error or timeout                                                           | `502 SLACK_UNREACHABLE`                                                                                                                       |

## Settings

The Slack card on **Settings → Integrations** (visible to administrators only, like the whole tab) has a **Slack profiles** section:

- **Sync Slack profiles** runs the sync. While it runs, the button says **Syncing…** and is disabled.
- A success shows one summary line, for example "Synced 3 of 3 mapped people · 1 new · 2 updated", and lists deactivated, bot, cross-workspace and not-found counts when they are not zero.
- A failure shows the server's message in the shared error state, for example the missing `users:read` scope or the rate-limit wait.
- When the deployment lacks `SLACK_BOT_TOKEN` or `SLACK_TEAM_ID`, or this workspace is not `INTEGRATIONS_WORKSPACE_ID`, the button is disabled and the section explains which environment variable names the operator must set. It never shows their values. `GET /api/v1/integrations` returns `slack.profiles_configured` and `slack.profile_sync` (last attempt: time, actor name, outcome, counts).
- The configuration JSON template shows both `user_map` and `source_person_map`.

## Where the Slack name and photo appear

All places use the one projection:

- Assignee pickers, project lead and initiative owner pickers, and the task-list assignee filter: option label and photo.
- The task row's and board card's assignee control, the task preview's assignee, and any card or row rendered without an assignee control, such as the card being dragged (it was initials-only before).
- People settings: the member's photo. The row keeps the account name, because role changes act on the account; the person card shows the projection name.
- Person cards opened from comments, activity and anywhere else.
- Server-rendered names: `assignee_name`, comment `author_name`, activity `actor_name` (UB-29).

A photo that fails to load falls back to initials (`Avatar` drops the failed URL). **Old names and emails stay searchable:** picker search also matches every name and email of the person's aliases, so "jchen" still finds a person now shown under their Slack name.

There is no visible "imported" postfix. Commit `dee62bd` removed it; `tests/e2e/people-layout-feedback.spec.ts` asserts its absence. Provenance stays in the data: `provider`, `source_id`, the aliases and the person card's account list.

## Outbound links

The worker's `chat.postMessage` text links to `<APP_URL>/tasks/<issue id>`, the canonical task route. It linked to the legacy `/issues/<id>` before. The GitHub issue export body uses the same `/tasks/<issue id>` link for the same reason; its `tickets-outbox` marker is unchanged.

## Operator steps (cannot be done by agents)

1. Create a Slack app for the workspace, add bot scopes `chat:write` and `users:read` (not `users:read.email`), install it, and note the Bot User OAuth Token, the Signing Secret and the Team ID.
2. In the Vercel project `tasks-app`, Production, as Sensitive variables: `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`, and `INTEGRATIONS_WORKSPACE_ID` set to the Tasks workspace ID. Redeploy.
3. In **Settings → Integrations → Slack**, map Slack user IDs (Slack profile → ⋯ → Copy member ID) in `user_map` for members and in `source_person_map` for imported people, and save.
4. Press **Sync Slack profiles** and check the summary. Then check names and photos on a phone and on a desktop.

## Acceptance mapped to tests

| Criterion                                                                                                      | Test                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slack installation and user IDs; real returned photo URLs; display_name → real_name → canonical name; no email | `tests/unit/slack-profiles.test.mjs` — _sync pages users.list with the bot token and stores mapped profiles…_, _empty Slack names fall back…_                                                                                                                                                              |
| Provider token never exposed                                                                                   | _Slack failures map to their own codes…_ (responses, stored state and logs are searched for the token); _only administrators can run the sync…_                                                                                                                                                            |
| Same name/photo projection in names, selected values, suggestions, history                                     | _sync pages users.list…_ (catalog bindings, canonical people, server `assignee_name`); `tests/e2e/slack-profiles.spec.ts` — _Slack names and photos show…_ (Chromium and WebKit)                                                                                                                           |
| Old names and emails remain searchable                                                                         | `tests/unit/people-directory.test.ts` — _picker search matches every alias name and email_; e2e _assignee search finds a person by an old name or email_                                                                                                                                                   |
| No visible imported postfix; provenance in metadata                                                            | `tests/e2e/people-layout-feedback.spec.ts` (existing); rows keep `provider`/`source_id`: _sync pages users.list…_                                                                                                                                                                                          |
| Empty display name, missing_scope, deactivated user, 429                                                       | _empty Slack names fall back…_; _Slack failures map to their own codes…_ (a refused request neither extends the pause nor is audited); _a sync that succeeds while another sync recorded a Slack rate limit keeps that pause_; _a second sync is idempotent and keeps deactivated users and bots flagged…_ |
| Broken image fallback                                                                                          | e2e _Slack names and photos show…_ (a 404 photo renders initials)                                                                                                                                                                                                                                          |
| Reject cross-workspace mappings                                                                                | _sync rejects users from another Slack workspace…_; _imported-person mappings accept only existing non-Slack people of this workspace_                                                                                                                                                                     |
| Admin-only, clear not-configured errors                                                                        | _only administrators can run the sync…_; e2e _Settings syncs Slack profiles…_, _…disabled with an explanation…_, _members do not see…_                                                                                                                                                                     |
| Imported-person binding in the projection                                                                      | `tests/unit/canonical-people.test.mjs` — _a Slack profile bound to an imported person…_                                                                                                                                                                                                                    |
| Two Slack user IDs on one member are held apart and marked for review                                          | `tests/unit/canonical-people.test.mjs` — _two Slack profiles bound to one member bind to neither…_                                                                                                                                                                                                         |
| Outbound links use /tasks/<id>                                                                                 | `tests/unit/transport.test.mjs` — _signed Slack slash command…_ asserts the posted text; _GitHub issue export links the canonical task route_                                                                                                                                                              |
| Malformed Slack pages and mappings saved mid-sync are never reported as not found                              | _a malformed page cursor fails the sync…_; _a mapping saved while the sync reads Slack waits for the next sync…_                                                                                                                                                                                           |

## Rejected alternatives

- **`users:read.email` and automatic email matching** (variant A) — rejected by the operator decision above.
- **Copying the mapped member's email onto the Slack row** (the decision note's pseudocode) — rejected in favor of the UB-29 binding. The binding already joins the profiles. A copied email would keep merging them through a stale copy after an administrator removes the mapping.
- **Storing every Slack user** — rejected. Every stored source person becomes a picker entry, so the whole Slack workspace would appear in assignee pickers, and it would keep profile data of people nobody chose to link.
- **A migration adding `bot`/`deactivated` columns** — rejected. The flags fit the private settings row, and production migrations need separate operator approval.
- **Slack user ID as the bare source ID** — rejected. UB-29 already defines `<team>:<user>` and detects the same user ID under two teams.
- **Letting `user_map` values be imported people** — rejected. `user_map` also authorizes Slack commands, which need a member; a separate map keeps that meaning.
- **Retrying a 429 inside the request** — rejected. A Vercel function would wait on Slack while holding the request; the pause is recorded and shown instead.
- **A GET-triggered or scheduled sync** — rejected. The sync writes and calls Slack only on an administrator's action.

## Out of scope

- Live acceptance against a real Slack workspace. It needs the operator steps above.
- Hiding a stored Slack profile whose mapping was removed.
- Slack profile photos in the person card's account list or activity rows beyond the existing avatars.
