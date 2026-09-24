# Team management and mobile dock — 24 September 2026

Continues published public-shell release PR22/main2ceaec4. This increment adds no content migration, production account change or credential operation.

## Team management

Each team in Your teams now has Rename team and Delete team in its existing ellipsis menu for workspace admins/owners. Rename checks the previous name to prevent overwriting a concurrent change. Delete first inspects linked issues (including archived/deleted records), project memberships and cycles. It requires the exact team key, rejects nonempty teams and the last team, and never deletes linked work. Workspace locks protect concurrent delete/rename; server authorization and confirmation are enforced independently of the UI. Canceling the dialog issues no deletion request. The work was tested only with synthetic empty teams, never by deleting a production team.

## Dock

The touch dock compacts while the document scrolls down, expands while scrolling up or near the top, and keeps targets at least44px. It stays expanded while keyboard focus is within the controls and does not cover the software keyboard. Reduced-motion uses instantaneous changes. Native Safari address-bar behavior itself is not implemented or claimed by this application.

## Executed acceptance

The missing team endpoints and dock-collapse attribute were first reproduced as failing tests. The implemented backend passes2team unit scenarios. Eight targeted Chromium/WebKit cases pass: computed16px field text without zoom restrictions, document scroll/floating header/dock collapse, typed-confirmation removal of an empty test team, and safe cancellation/nonempty-team explanation. Full-suite and final review results are recorded in the release PR.

## Unresolved work kept separate

Private workspace-content restoration has two executed red browser tests in external pending evidence. The attempted auth-bound cache coordinator and further cache acceptance writes were rejected by tool safety checks; no session override or private cache was installed through another transport. The original warm-start and offline-content requirements remain open, not silently replaced by the already published public-shell cache.

A touch-hold menu prototype opens the correct actions but incorrectly suppresses a rapid subsequent intentional ellipsis click. Its attempted correction was rejected before execution. The flawed hook is not included in this release; source/trace and red acceptance are preserved outside the active build. Other keyboard, invitations, reference-parity and Slack work remains separate; no blanket completion claim.

## Referential integrity review evidence

Schema review found exactly four tables with foreign keys to teams: statuses, issues, project_teams and cycles (all declared in0001.sql). Statuses are removed only after all work counts are zero, inside the same transaction. There are no team-membership/template/label-per-team FK tables in this schema. Saved-view filters are query metadata, not cascade-owned team records.

Normal REST writes take the workspace advisory lock in app.mjs run(false); GraphQL mutations take the same lock in packages/linear/handler.mjs. Webhook receipt and application also lock the workspace. Import apply(service.mjs:309), append(plan_hash) and bind(plan_hash) take the same workspace lock before applying source changes. Team rename/removal explicitly take that lock again. PostgreSQL uses pg_advisory_xact_lock; SQLite test transactions serialize and enable foreign_keys. The final team/status deletes additionally remain protected by database foreign keys and transaction rollback.

Additional tests verify two concurrent empty-team removals leave exactly one team, PRAGMA foreign_key_check remains empty, and read-scoped credentials can inspect but cannot rename/delete. These tests use the isolated in-memory fixture; no production team was removed.
