# UI follow-up review — 13 September 2026

Service: **https://tickets-ultrabricks.vercel.app**.

Tested application-code commit: `8461bc9537b8815c072919402748415bd34c822a`.

## Changes and evidence

The previous release PR #2 is merged. This follow-up adds the mobile +/ellipsis capsule, native keyboard-operable menus, larger page headings, compact property pills, safe-area viewport support, and explicit 44 px targets for primary mobile actions. New and existing documents retain the shared inline editor.

Concrete bugs fixed: previews remaining after their source scrolled, competing previews, native preview dialogs not blocking workspace shortcuts, team/saved-view navigation leaving its sheet open, and long titles being clipped after viewport changes. Preview actions expose pending state and no longer falsely promise that a failed acknowledgement means nothing changed.

The first observer fix was reviewed and found to allocate an observer on every keystroke. Its regression produced 57 observations rather than the initial 2 under development Strict Mode. The final implementation retains one observer per mounted editor, disconnects it on unmount, and independently resizes on text/width changes. Regression tests verify allocation stability and full title visibility in both browser engines.

| Final verification | Result |
| --- | --- |
| Unit tests, lint, generated contracts/tokens, production build | 150 tests passed; all commands passed |
| Independent TypeScript and owned-source formatting | Passed |
| Chromium and WebKit end-to-end scenarios | 88 passed |
| Storybook interactions/accessibility | 18 passed; build passed |
| PostgreSQL 17.11 isolated acceptance | 79 passed; no production database was used |
| Ordinary visual comparison | 5 passed on each of macOS ARM64, Linux ARM64 and Linux x64 |
| Credential-pattern scan | Passed; not an exhaustive security audit |

Tests were finalized in an isolated worktree with separate output/cache directories after shared-run artifacts collided. No test assertion was weakened to hide that infrastructure failure. Final read-only consistency, correctness and performance review found no introduced defects in the corrected delta.

## What the reference audit establishes

The audit uses an existing public Linear desktop capture and a real Tickets issue with the same title and body at 1440×1000, DPR 1. The title and description text origins differ by **0.171875 px horizontally and 0 px vertically**. The native-coordinate overlay and absolute-difference image are published with source hashes.

**Global 90%+ UI similarity is not established.** The original 50-screen PDF was not found in available files or local project references. Navigation modules, fonts, activity content and unpaired mobile states still differ. A mostly dark canvas can yield a deceptively small average pixel error; that number is not converted into a similarity percentage. Passing internal visual baselines is not proof of Linear parity.

[Matched-state measurements](screenshots/review-2026-09-12/reference/audit.json) · [50% overlay](screenshots/review-2026-09-12/reference/overlay-50.png) · [4× pixel difference](screenshots/review-2026-09-12/reference/difference-x4.png)

## Screenshots

[Mobile projects](screenshots/review-2026-09-12/projects-mobile.png) · [Mobile issue list](screenshots/review-2026-09-12/issues-mobile.png) · [Capsule menu](screenshots/review-2026-09-12/actions-mobile.png) · [Preview](screenshots/review-2026-09-12/peek-mobile.png) · [New issue](screenshots/review-2026-09-12/new-issue-mobile.png) · [Desktop document](screenshots/review-2026-09-12/issue-desktop.png)

[Platform-specific baseline hashes](screenshots/review-2026-09-12/baseline-provenance.json). All published UI images are captures of the running application on synthetic local data. No font files or production credentials are distributed.

## Account and production acceptance boundaries

The requested additional account was **not created by this session**: the tool rejected account-provisioning operations. The announced proposed password was not activated. No existing owner credential was reset by this work. A prepared command is not presented as successful account creation.

Production authenticated owner CRUD and a live private Blob transfer remain separate, unverified checks. The public readiness/anonymous-denial checks must not be substituted for them. Clean deployment and public readiness observations are recorded in the pull request after promotion.

