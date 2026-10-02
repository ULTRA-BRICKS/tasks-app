# People identity — canonical presentation and verified bindings (UB-29)

Task identity: `06d0781d-b4b5-45c7-9cc0-d2385ad2c8c7` (currently UB-29). This increment implements the ticket without a migration: one identity projection shared by the client and the server, fed by explicit Slack bindings, plus bot separation, alias-aware assignee filters, a review surface for conflicts and a read-only inventory function. It extends the grouping described in [PEOPLE-AND-PHONE-LAYOUT.md](PEOPLE-AND-PHONE-LAYOUT.md).

## Decision: no alias table, no migration

Settled by the review quorum on 29 September 2026 (evidence outside Git: `~/xp/.tasks-work-evidence/decisions-20260929/UB-29-quorum.md`, `UB-29-quorum-r2.md`, `UB-29-inventory-projection.txt`).

- No `identity_aliases` table and no production migration. The canonical identity is the Tasks member account. Linear `source_people` rows stay aliases computed at read time.
- The Ultra and Danny pairs found by the read-only inventory are cross-provider, same-email pairs (a member plus its Linear author). The acceptance criteria allow such pairs to share a presentation identity. The projection groups them (14 records present as 12 options), and no stored row changes.
- Explicit verified links continue to come only from the Slack module `user_map`.
- A durable table becomes a question for the operator again only if a genuinely ambiguous match or a non-email verified binding appears.

## Inputs

- **Tasks members** — `users` joined with `memberships` of the workspace (provider `tasks`). They are accounts and always count as humans.
- **Source people** — `source_people` rows (provider `linear`, later `slack`). They are attribution records; they never become accounts or memberships.
- **Explicit verified bindings** — the Slack module `settings.user_map` (Slack user ID → member ID), written only by an administrator through `setIntegrationConfig`, which already rejects non-members. Slack source profiles use `source_id` `<Slack team ID>:<Slack user ID>`. A mapping becomes a binding only when the Slack module is enabled, the mapped member is a current member, and exactly one Slack source profile in the workspace carries that Slack user ID. The catalog exposes only the resulting pairs as `identity_bindings: [{ member_id, source_person_id, via: 'slack_user_map' }]`. Entries that fail a condition (`module_disabled`, `unknown_member`, `no_source_profile`, `ambiguous_source_profile` when the user ID appears under two Slack teams) are reported by the inventory and never applied.

## Grouping rules (in order)

1. **Bots stay separate.** A profile is a bot when its provider says so (`bot: true`) or when it is a Linear profile on a reserved automation domain: `@oauthapp.linear.app` (OAuth applications such as Codex and Cursor) or `@linear.linear.app` (Linear's own system user). The catalog returns this flag on `source_people`. A bot never joins another identity, neither through a binding nor through email. A binding that touches a bot is refused and reported as `bot_binding`.
2. **Explicit bindings first.** A valid binding joins the member and the bound source profile, whatever their emails. A source bound to two different members is `conflicting_binding`, and none of those bindings apply. A binding that names an unknown profile is `unresolved_binding` and does not apply.
3. **Unambiguous cross-provider email only.** Emails are normalized by trimming and lower-casing only; dots and `+` suffixes are significant. All non-bot profiles that share a normalized email join one identity only when no provider appears in more than one of the identities being joined. Otherwise nothing in that email group merges by email, and a conflict is reported:
   - `same_provider_email` — two or more profiles of one provider share the email (for example two Linear users). This is a review conflict, never an automatic merge.
   - `ambiguous_email` — joining would put two identities of one provider into one person, for example a second Slack profile beside an explicitly bound one, or two Tasks accounts linked through a binding.
     Decisions are made against the binding-only identities and then checked on the combined result. Input order therefore never changes the outcome.
4. **Never by name or avatar.** Equal names and equal photos are not evidence.
5. A profile without an email and without a binding stays on its own.

## Presentation

- The canonical ID is the Tasks member ID when the identity has one, otherwise the first profile's ID. The name follows the name chain and the avatar the avatar precedence in [Names and avatars for every person](#names-and-avatars-for-every-person-ub-95).
- `aliases` keeps every original ID. Every legacy author, assignee, lead and owner ID resolves to its canonical person; assignment still writes through the existing authenticated, version-checked API.
- **One person, one picker entry.** The assignee, project lead, initiative owner and task-list assignee filter pickers show each canonical person once. Profiles held apart by a conflict stay separate entries, labeled with their provider and "Needs review" so a user can see which record is which. Bots are labeled "Bot".
- **Server-rendered names.** Task `assignee_name` (detail and list), comment `author_name` (including the response to a new comment), activity `actor_name` and the people named in imported Linear assignee changes use the same projection. The stored-name SQL remains only as the fallback for IDs the projection does not know, such as former members. The projection is loaded once per transaction; the catalog reuses it for `people`, `source_people`, `identity_bindings` and the counts.
- **Alias-aware filters and counts.** `assignee_id=<any alias>` and `assignee_id=me` match every stored ID of that canonical person, in both the member column and the source column. The "My tasks" navigation count uses the same alias set. Bots and conflict-separated profiles match only themselves. The Linear-compatible GraphQL filters keep exact-ID semantics.
- **People settings.** When the projection holds conflicts, the People tab shows a read-only "Identity review" section. It lists each conflict with its profiles (name, provider, email) and the reason. Members involved in a conflict carry a "Needs review" marker. The section offers no merge, split or write action.

## Invariants

- Catalog, list, detail and filter reads only read. Accounts, memberships and roles, source people, and task, comment and activity attribution rows are identical before and after the projection. The count tests check this.
- No membership grants: a binding neither creates an account nor changes a role.
- No historical author changes and no deletion of source identities.

## Catalog exposure

Every catalog reader, viewers included, receives `identity_bindings`, because pickers, lists and the People tab of every role render the same canonical people. The field is kept minimal: verified pairs only, and only the three fields `member_id`, `source_person_id` and `via`. It carries no Slack user ID, no unverified or refused mapping and no other module setting; the catalog test pins that exact shape. It does not widen exposure: before this change `catalog.modules[*].config` already returned the whole Slack `user_map` to every reader, and the canonical names the server renders reveal the same links. Restricting `modules[*].config` to administrators is follow-up UB-73; `identity_bindings` stays readable after it.

## Inventory

`identityInventory(input)` in `packages/server/core/source-people.mjs` is pure. From supplied rows it reports the workspace ID, every profile (ID, provider, source ID, role, normalized email, bot flag, canonical ID), every Slack mapping entry with its status, shared email groups, conflicts and counts. `loadIdentityInputs(tx, workspace)` supplies those rows using `SELECT` statements only. Both are tested on synthetic fixtures. **Neither has been run against production in this increment.** A later operator run must stay read-only and keep its output outside Git, because it contains real emails.

## Acceptance mapped to tests

| Criterion                                                                                               | Test                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inventory of member/source/provider IDs, workspace ID, normalized emails and bindings before any write  | `tests/unit/identity-bindings.test.mjs` — _inventory reports IDs, normalized emails, mapping status and conflicts_                                                                                                       |
| Explicit verified links first                                                                           | `tests/unit/canonical-people.test.mjs` — _explicit Slack binding joins a member…_, _conflicting and unresolved bindings are refused…_; `identity-bindings.test.mjs` — _catalog applies only unambiguous Slack mappings…_ |
| Only unambiguous cross-provider email; never by name or avatar                                          | _same names and photos never merge…_, _email matching does not strip dots/plus aliases…_, _projection does not depend on input order_                                                                                    |
| Same-provider duplicate emails are a review conflict                                                    | _same-provider duplicate emails stay separate and are marked for review_; _binding plus email that would add a second profile of one provider is ambiguous_                                                              |
| Bots and humans stay distinct                                                                           | _bots never join a human…_; _Linear OAuth-app and system addresses are bots…_                                                                                                                                            |
| Legacy IDs stay resolvable; one entry per person per picker; selection maps to the canonical assignment | `tests/unit/people-directory.test.ts`; `identity-bindings.test.mjs` — _server names and assignee filters use the canonical person across aliases_                                                                        |
| Unchanged account, role and history counts                                                              | `identity-bindings.test.mjs` — _catalog projection leaves account, role and history counts unchanged_                                                                                                                    |
| People review state and one-entry pickers in real browsers                                              | `tests/e2e/people-identity.spec.ts` (Chromium and WebKit)                                                                                                                                                                |

## Rejected alternatives

- **Durable `identity_aliases` table and migration** — rejected by the quorum decision above.
- **Automatically picking one of the same-provider duplicates** (newest, most active, matching name) — rejected. Picking one is a guess; the conflict is shown for review instead.
- **Letting the client interpret the raw `user_map`** — rejected. The server resolves bindings and returns only the pairs.
- **Tying bindings to the `SLACK_TEAM_ID` environment variable** — rejected. The ticket service has no environment access, and client and server must build the same projection. A Slack user ID found under more than one team is refused instead.
- **Normalizing email local parts** (dropping dots or `+tags`) — rejected; they can be different mailboxes.
- **Deduplicating the task-list assignee filter on the client only** — rejected. The server now expands the chosen person to its aliases, so no legacy-attributed task is hidden.
- **Resolving only the IDs present in a response** (a targeted `WHERE id IN (…)` per list or detail) — rejected. Email grouping and conflicts depend on every profile of the workspace, so a partial load can name a person differently from the catalog. Instead the whole-workspace projection is linear in the number of profiles and loaded once per transaction.

## Names and avatars for every person (UB-95)

Task identity: `ff9d9d64-3a61-436e-8ab8-559bf0b3adaa` (currently UB-95). User report, 30 September 2026: Danny has no avatar, and Niko is shown by his email address instead of a name, although the viewer is an administrator.

### Root cause

The data evidence stays outside Git, because it contains real emails: `~/xp/.tasks-work-evidence/people-names-20260930/inventory-before.md`. It was built from the read-only production catalog snapshot of 30 September and the Linear export of 17 September.

- **Niko: an email in the name slot.** Linear stores an address as the `name` of a user who never entered a full name. In the export, Niko's `name` is his address and his `displayName` is the local part; Tekla, Danny and one former user have the same shape. The import keeps Linear's `name` (`packages/imports/linear-projection.mjs:67`), and so does the live sync (`packages/server/modules/linear-live/model.mjs:100`). Niko has no Tasks account and no Slack profile. The projection therefore took the name of its only profile verbatim (`src/shared/lib/canonical-people.mjs`, `name: slack?.name?.trim() || identity.name`).
- **Danny: no photo in any stored source.** His Tasks account has no `users.avatar_url`, because nothing writes that column, and the catalog did not even return it (`packages/server/core/source-people.mjs`, members query). His Linear profile has `avatar_url = null`, for three reasons:
  1. The Linear export never requested `avatarUrl`.
  2. The import hard-coded `avatar_url: null` (`packages/imports/linear-projection.mjs:69`).
  3. The live sync does fetch `avatarUrl`, but its reconcile scan skips a user whose Linear `updatedAt` equals the imported snapshot's. The scan page carried only `id updatedAt archivedAt` (`client.mjs`, `readSourcePage`), and the baseline built from a snapshot without `avatarUrl` says "no photo" (`scan-unchanged.mjs`). A photo that Linear held before the export therefore never arrives unless the profile changes again.

  Five of the twelve Linear profiles got photos after the sync was activated on 27 September; Danny's and Niko's did not. No Slack profile sync is configured in production yet (UB-34).

### Name chain

A **real name** is a trimmed, non-empty name that is not shaped like an email address (`local@domain`). The projection names every person in this order:

1. The Slack profile's name (its display name), when it is a real name.
2. The identity's own name: the Tasks account name, or for a person without an account, the name of that person's first profile.
3. The real name of any other linked profile, taken in a fixed order: Tasks, Slack, Linear, then other providers, and by ID within a provider. For example, a Linear full name wins over a Tasks account whose name is an address.
4. As a last resort, a name derived from the email address. The local part loses any `+tag`, is split on `.`, `_` and `-`, and each word is capitalised: `niko@…` → "Niko", `irine.latsoshvili@…` → "Irine Latsoshvili". The identity's email is tried first, then any email-shaped name, then the other profiles' emails.
5. "Unknown person" when a profile has neither a real name nor an address.

A raw email never fills a name slot. That covers pickers and their options, list rows and board cards, the task preview, task properties, comments, activity (actor and assignee values), the person card, the People page, the identity review's profile names, and the `assignee_name`, `author_name` and `actor_name` fields the server renders, including their stored-name fallbacks for former members. Emails stay where an email belongs: the option description, the card's email line, the People page's email line and the search keywords. `names` holds each profile's presented name and is used only for search.

Stored data is not changed. `source_people.name` keeps Linear's value, and the chain runs at read time in the shared projection, the same way on the client and on the server.

### Avatar precedence and fallback

1. The Slack photo.
2. The Tasks account's `users.avatar_url`, which the catalog now returns for members.
3. The photo of any other linked profile, for example Linear's `avatarUrl`.
4. Otherwise, an initials avatar drawn from the presented name. Its tone is one of eight hues derived from that name, so the same person has the same colour on every surface, and different people are easier to tell apart. The hues rotate the theme's accent token (`oklch(from var(--color-accent) …)`), so no new token is needed. Browsers without relative colour syntax keep today's accent tone.

Avatar images keep the existing rules: HTTPS or same-origin only, no referrer, and a fallback to initials when an image fails to load.

### Linear photos: import, live sync and the production step

- **Import.** `avatarUrl` is mapped when the snapshot has it and it is an `https:` URL of at most 2048 characters. Otherwise the import stores `null`, as before.
- **Live sync.** The users scan page now also reads `name email avatarUrl`. A Linear profile whose scanned name, email or photo differs from the stored baseline is queued, even when its `updatedAt` did not change. This follows the same rule that keeps archive and identifier changes discoverable. The queued entity job reads the profile afresh and updates `source_people` through the existing, version-free people patch (`name`, `email`, `avatar_url`). Once the job converges, the next scan finds the profile unchanged again, so nothing is queued on every pass.
- **Production step (operator).** No migration, no data rewrite and no new endpoint. After the orchestrator deploys this change, the next cron reconcile (`/api/internal/linear-sync`) pulls every Linear photo and name that differs, or an administrator can start one at once with the existing `POST /api/v1/sync/linear/reconcile`. Then compare a fresh read-only catalog inventory with `inventory-before.md`. A person still without a photo afterwards has none in Linear. That person keeps the toned initials until a Slack photo arrives through UB-34, which needs its own operator setup.

### Every person is listed

The catalog returns every member and every source profile to every workspace role. The People settings tab renders the following, while profiles held apart for an identity conflict remain in Identity review rather than appearing in the accountless list:

- **Members.** Their rows use the canonical name and merged photo, not the stored account name.
- **People without a Tasks account.** A read-only list below the members shows each non-review-held canonical person without an account: photo, name, linked providers (or "Bot") and email. Examples are Linear-only people such as Niko and the Linear automation apps. Each name opens the person card. There is no role control, because these people have no membership.

### Acceptance mapped to tests (UB-95)

| Criterion                                                                                            | Test                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name chain; an email is never a name; precedence across linked profiles                              | `tests/unit/canonical-people.test.mjs`: _an email-shaped name falls back…_, _a real name from any linked profile wins over an address…_                          |
| Server-rendered names and catalog photos                                                             | `tests/unit/identity-bindings.test.mjs`: _server names never show an address and the catalog returns member photos_                                              |
| Linear photos reach `source_people` through import and reconcile, idempotently                       | `tests/unit/linear-import.test.mjs` (avatar mapping); `tests/unit/linear-scan-unchanged.test.mjs`: _a Linear profile photo missing from the snapshot is pulled…_ |
| Danny and Niko shapes on the People page, assignee picker, list row, board avatar, card and activity | `tests/e2e/people-names.spec.ts` (Chromium and WebKit)                                                                                                           |
| Desktop 1440×900 and phone 390×844, WebKit and Chromium                                              | Visual proof outside Git: `~/xp/.tasks-work-evidence/people-names-20260930/visual/`                                                                              |

### Rejected alternatives (UB-95)

- **Rewriting stored names or photos in production** (setting Niko's `source_people.name` to "Niko") — rejected. It is a production data write, and the next Linear sync would restore Linear's value.
- **Storing Linear's `displayName` when `name` is an address** — rejected. It changes the fields the live sync compares with its baselines, which would queue or export every such profile. For every affected profile in the inventory, `displayName` is exactly the email's local part, so the derived name is the same apart from capitalisation.
- **A new admin-only "backfill people" endpoint** — rejected. The existing reconcile (cron or admin) already reads each Linear user. It only needed the scan to see profile fields.
- **Gravatar or other guessed photo URLs** — rejected. Guessing a photo for an address sends that address, hashed, to a third party without consent. Only photos returned by a connected provider are shown.
- **One fixed avatar colour** (the previous behaviour) — rejected. People without a photo all look alike, which is part of the report.

## Out of scope

- The Slack profile sync, Slack photos and `users:read` scopes belong to UB-34.
- A bot flag supplied by Slack (`is_bot`) needs that sync. The projection already honors `bot: true` from any provider.
