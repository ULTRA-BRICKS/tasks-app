> Latest release: [12 September 2026 verification](RELEASE-2026-09-12.md). The results below are historical.

> Historical evidence for the 2026-09-10 GitHub revision only. It does not describe the current Forgejo release or current production readiness. For the current operational contract, see [OPERATIONS.md](OPERATIONS.md); the current release report will name its exact tested commit.

# Verification — 2026-09-10

## Verified source

Full CI for commit [`73763a18549bf9eb7fb288b773aae586fbf610f4`](https://github.com/alex-mextner/tickets-app/commit/73763a18549bf9eb7fb288b773aae586fbf610f4) completed successfully:

**[CI run 34504461915](https://github.com/alex-mextner/tickets-app/actions/runs/34504461915)**

| Check                                                    | Result                       |
| -------------------------------------------------------- | ---------------------------- |
| Frozen Bun dependency installation                       | Passed                       |
| DTCG token generation/drift checks                       | Passed                       |
| REST OpenAPI generation/drift checks                     | Passed                       |
| GraphQL subset comparison to pinned Linear schema        | Passed                       |
| FSD imports, Oxlint and type-aware checking              | Passed                       |
| Independent TypeScript `tsc --noEmit`                    | Passed                       |
| Unit/HTTP/CLI/GraphQL/Markdown tests on Bun + SQLite     | 76 passed                    |
| Shared acceptance suite on a real PostgreSQL 17 service  | 66 passed                    |
| Production Vite build                                    | Passed                       |
| Source formatting and tracked generator-output checks    | Passed                       |
| Repository secret-pattern scan                           | Passed; not a security audit |
| Storybook production build                               | Passed                       |
| Storybook interactions and axe accessibility, Chromium   | 13 passed                    |
| Playwright end-to-end scenarios, Chromium                | 4 passed                     |
| Playwright comparisons against reviewed visual baselines | 5 passed                     |

The PostgreSQL suite deliberately reuses domain/API/GraphQL cases, so do not sum the two backends as distinct behavioral scenarios. No PostgreSQL fallback to SQLite is accepted by the test harness. The browser job checks creation, Markdown editing, status/filter changes, keyboard command navigation, a 393 px layout and read-only token permissions. It does not yet cover every drag-and-drop path, browser engine or concurrency scenario.

## Corrections retained with regression coverage

- Preserved browser HTTP headers instead of losing them when merging `HeadersInit` objects.
- Corrected draft synchronization and several hook/typing problems exposed by strict Oxc checking.
- Added the schema-checked GraphQL subset, parameterized filters, authenticated pagination cursors and permission/CSRF/complexity tests.
- Made PostgreSQL migration acceptance portable instead of executing SQLite `PRAGMA` on PostgreSQL.
- Fixed the Bun discovery root so PostgreSQL tests actually run.
- Shared Vite aliases with Storybook's browser runner.
- Made task-list checkboxes accessible without loading remote images or allowing raw HTML.
- Improved identifier/date contrast, including selected rows.
- Waited for Base UI portal/exit transitions in interaction tests; verified focus restoration rather than using fixed delays or dropping assertions.

## Screenshot evidence

The five screenshots in [screenshots/](screenshots/) were captured from the running React application and inspected before becoming baselines. [Provenance](screenshots/provenance.json) records the original source, artifact and SHA-256 hashes. The first capture was **not** a regression comparison. Subsequent CI runs, including the green run above, compared against those committed images without replacing them.

The local container's managed browser refused localhost with `ERR_BLOCKED_BY_ADMINISTRATOR`. Browser acceptance therefore ran on the authorized GitHub Actions runner; that container policy was not modified or bypassed. Local Bun tests, type checks and production builds ran separately.

## Not completed or not verified

A successful build and CI are not a production deployment. Direct `Vercel.deploy_to_vercel` calls returned a tool-contract error: the backend requires `target`, `name` and `files`, but the exposed action accepts no arguments.

The alternative [GitHub Actions deployment preflight](https://github.com/alex-mextner/tickets-app/actions/runs/34504403372) ran and reported that `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` were absent. No production deployment URL was created. The deployment workflow is installed, pinned to Vercel CLI 59.11.7, gates releases on successful CI, validates production configuration and migration versions read-only, and never seeds demo data. Its actual deployment steps remain unexecuted until authorized credentials and a linked project are supplied.

Neon was read again on this date: project `autumn-brook-27632436`, development branch `br-little-shape-b18w3vo1`, database `tickets`: **29 tables, schema version 2, zero users and zero issues**. Production branch `br-sparkling-morning-b1bs7tl5` still has **zero public tables**. Production migrations/bootstrap and backup/restore acceptance have not run.

No private S3/R2 bucket, GitHub App installation, or Slack App installation has been provisioned. Their adapters have synthetic/injected-transport tests, not live provider acceptance. OAuth, password recovery, MFA, full Linear SDK support, realtime/offline sync and comprehensive cross-browser testing remain outside this verified release.
