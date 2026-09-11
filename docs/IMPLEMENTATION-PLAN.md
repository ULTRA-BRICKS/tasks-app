# Tickets implementation plan

Started 2026-09-11 against main `054c4981571da2ea423c703fe84b116e2eb9b44f`.

## Objective and non-negotiables

Create a working, reference-led issue tracker rather than a form-based approximation. New and existing issues share one addressable document surface. Preserve GraphQL subset compatibility, workspace authorization and existing user data. Bun-first, Oxc, React/Base UI, FSD, executable DTCG tokens and atomic commits remain required.

The earlier local review patch was prepared on an older source snapshot. Do not replace main with that tree. Integrate changes selectively, preserving `packages/linear`, current CI and later fixes, and repeat checks on the integrated result.

## Ordered milestones

### 1. Establish reproducible source and review context

- [ ] Obtain the exact current source and inspect AGENTS.md, DESIGN.md and reference-led UI skill.
- [ ] Read frontend-design; record a short design plan, critique it against the requested Linear direction, then implement.
- [ ] Inventory usable references by platform, screen, state, capture dimensions and provenance.
- [ ] Establish a baseline test/build result; distinguish historic results from newly executed checks.

### 2. Development configuration and workspace policy

- [ ] Set API default 8888 in exactly one shared resolver, used by server, Vite, launcher and test infrastructure.
- [ ] Persist setup --demo --port overrides safely, preserve secrets, and make repeated demo setup non-destructive.
- [ ] Verify real proxy, occupied ports and local origin aliases without weakening production CSRF checks.
- [ ] Integrate versioned allowed_email_domains storage/API/UI; enforce on issuing and accepting invitations.
- [ ] Test migration and policy behavior on SQLite and PostgreSQL before calling this release-ready.

### 3. Issue document surface

- [ ] Replace modal creation with /issues/new and shared new/existing document primitives.
- [ ] Render title/body placeholders in final positions; use compact property pickers, not an input grid.
- [ ] Preserve local drafts, failed edits, concurrent typing and stable idempotent create retries.
- [ ] Remove the global Save bar; existing objects save committed inline edits.
- [ ] Check hover/focus padding and text alignment, read-only and conflict states.

### 4. Keyboard, planning and mobile

- [ ] Add and browser-test list focus, J/K/arrows, open/back, select, command menu and guarded navigation chords.
- [ ] Exclude input, IME and active overlay interactions from global shortcuts.
- [ ] Reuse the document model for project creation/detail and cycles where appropriate.
- [ ] Adapt mobile navigation and property layouts using actual mobile references, not enlarged desktop controls.
- [ ] Add long-press/peek only with selection-safe pointer cancellation and ordinary accessible action alternatives.

### 5. Measured visual comparison

- [ ] Capture the running app at matched viewport, DPR, theme, state and relevant content.
- [ ] Compare desktop with desktop and native-mobile references with an explicitly bounded web-mobile region.
- [ ] Produce 50% overlays, absolute difference and geometry/typography measurements for comparable regions.
- [ ] Record exclusions (system bars, different data, fonts, native-only chrome), without hiding layout errors.
- [ ] Correct tokens/shared primitives before per-screen overrides; review a second capture.
- [ ] Publish only synthetic application screenshots. User workspace screenshots/PDFs stay out of the public repository.

### 6. Review, integration and release

- [ ] Run Bun suites, Oxc, tsc, FSD, token/API/GraphQL drift and secret checks.
- [ ] Run Storybook interactions/accessibility, Playwright E2E and deliberate visual baseline comparisons.
- [ ] Review conflicts, authorization, draft loss and migration safety independently of visual appearance.
- [ ] Open a PR with atomic commits, actual evidence and explicit remaining gaps.
- [ ] Merge only verified coherent changes, without force push or copying an older tree over main.
- [ ] Keep native Vercel Git deployment as the intended publisher; remove contradictory deployment guidance separately.

## How progress is reported

Each completed item must cite a commit, command result or inspected capture in the implementation log. A branch with no new commits is not progress. A generated screenshot is not an approved baseline. A green self-regression test is not Linear fidelity. Do not claim a percentage match unless the compared regions and metric actually justify it.

Production credentials, migrations/bootstrap, storage provisioning and live GitHub/Slack installation are separate acceptance steps. Do not publish private data or seed demo accounts into production. No ZIP/source archive is a user deliverable.
