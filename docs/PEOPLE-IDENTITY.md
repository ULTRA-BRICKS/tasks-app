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

- The canonical ID is the Tasks member ID when the identity has one, otherwise the first profile's ID. The name comes from the Slack profile when present, otherwise from that identity. The avatar comes from Slack, then the identity, then any profile.
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

## Out of scope

- The Slack profile sync, Slack photos and `users:read` scopes belong to UB-34.
- A bot flag supplied by Slack (`is_bot`) needs that sync. The projection already honors `bot: true` from any provider.
