# Rename to tasks-app — 15 September 2026

Canonical repository: https://git.hyperide.ai/ultrabricks/tasks-app .
Active working copy: `/Users/ultra/xp/tasks-app` (moved with `git worktree move`, not recopied).

The repository was renamed in place using Forgejo's normal repository edit. The remote main SHA is identical before and after. The local origin was updated. All staged and uncommitted work was preserved; the staged tree immediately after the move remained `81f708c8a3e0aa8707fbbc5233388066e72d3a3c`.

The existing Vercel project was renamed to `tasks-app` without creating a second project: ID `prj_BicxQsqDlb394HzvMuXZKB883EdY` is unchanged. No database, user account, environment credential or deployed code was changed by these metadata operations.

Source branding now uses package name `tasks-app`, page title `tasks-app`, login label `TASKS`, API title `tasks-app API`, and health service `tasks-app`. The `tasks-app` executable alias points to the existing CLI implementation; `tickets` remains available. The dev-server detector accepts both old and new service names during the transition.

## Compatibility intentionally retained

The canonical live origin remains https://tickets-ultrabricks.vercel.app . Do not move users to another origin without explicit recovery/export of browser drafts. Renaming a repo or a Vercel project does not migrate localStorage, sessionStorage or browser cookies between origins.

Existing `tickets_session`, `x-tickets-csrf`, draft storage keys, database lock namespaces, module IDs, API resource names, TICKETS_* environment variables and the protected `~/.config/tickets-app` credential directory are retained. These are compatibility identifiers, not missed branding replacements. Historical screenshots/logs still describe the names and code actually captured.

## Release boundary

Repository/project renames are applied. The rename is isolated into its own reviewed release; unfinished account-mail and draft work is deliberately excluded. Until promotion is actually recorded, source branding is not claimed live. A local green build does not mean the live HTML has been republished. See WORK-CHECKPOINT.md for exact gates and unresolved findings.
