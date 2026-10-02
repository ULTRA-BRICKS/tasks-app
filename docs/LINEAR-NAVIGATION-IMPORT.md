# Linear migration completeness: saved navigation

17 September 2026. This increment extends the existing verified import; it does not certify a production migration or deployment.

## Native support

Optional snapshot collections `customViews` and `favorites` keep older snapshots readable. Each declared collection is checksum/count verified, staged and retained in immutable source records with deterministic mappings. Shared saved issue views preserve original owner attribution, description, timestamps, archive state and team scope. Their supported AND/project/state comparisons become native multi-value issue filters; unsupported models, operators and private-owner mappings fail before application records are inserted. Empty IN selections match no rows.

Personal favorites preserve order and target references and appear as functional sidebar links. The authenticated API supports list/create/delete, owner-scoped access, target validation, module gating and repeat-safe creation. Existing workspace memberships are matched by normalized email. No account, invitation, membership or password is created. A favorite without a matching existing member is retained with source attribution and no login owner; it is not exposed to the importer. Personal favorites in a Linear export cover only the authorized viewer, not every user's private navigation.

## Verification in this continuation

The fresh read-only snapshot contains 1,704 issues, 1,321 comments, 5,267 history events, 12 projects, 7 milestones, 4 documents, 1 initiative, 750 issue relations, 1,040 attachment/link metadata records, 2 saved views and 3 favorites. Native HTTP handler rehearsal imports and replays the complete snapshot without duplicates or account creation. Source view membership was separately read from Linear, then compared against every page of the imported native queries: 195/195 and 474/474 IDs, with zero missing or additional IDs. This caught and fixed omission of the source view's team scope, which had exposed 113 extra results in the rehearsal.

181 unit tests, generator checks, lint, both type checkers, build and the credential-pattern scan passed. Four focused Playwright cases passed in Chromium and WebKit at desktop and mobile widths, exercising filtered navigation, reload, favorites, deep links, overflow and runtime errors. Earlier full-suite evidence remains separate; this continuation did not repeat the entire browser/Storybook suite. Browser evidence is synthetic, not captured private source content.

167 cached private files were rehashed against the new snapshot. 27 references are unavailable upstream (previous HTTP 404 checks); their references and status are retained. The rehearsal verifies private bytes through the isolated storage adapter, not production Blob. No files or source descriptions are committed to Git.

## Deployment boundary

Schema 8 adds saved-view provenance and the owner-scoped favorites table. A new combined schema 5–8 plan was prepared on a separate temporary Neon branch. Postgres readback confirms version 8, all four view columns, the favorites ownership index and three foreign keys, while existing accounts and memberships remain unchanged. Production remains on schema 4. Do not apply the older schema 5–7 plan as the complete migration for this code.

Operator confirmation is required before the prepared production migration. Then publish clean reviewed source, transfer/read back private production objects, approve the exact refreshed import plan, apply through the authenticated application and reconcile live content and relationships. Refresh and recheck source drift at cutover; a snapshot is not continuous synchronization. External credentials, other users' private preferences and login grants are not automatically copied.
