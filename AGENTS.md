# tickets-app contributor instructions

## Product contract

Build a modular, open-source Linear-like issue tracker for a small team. Issues, projects, cycles, Markdown, attachments, relations, GitHub and Slack integrations share one domain layer. Public source does not imply public workspace data.

## Toolchain

- Use Bun for installing dependencies, scripts, the server, CLI, and unit/integration tests. Commit the text `bun.lock`; do not add npm, pnpm, or Yarn lockfiles.
- Use Oxc: Oxlint for linting, Oxfmt for formatting, and the Oxc-powered Vite/Rolldown toolchain where supported. Do not replace type checking with transpilation.
- Storybook tests run in a real browser; Playwright verifies end-to-end and visual behavior. Do not claim a check passed unless its command completed successfully.
- Keep commits atomic and descriptive. Do not commit generated archives, static design mockups, credentials, `.env.local`, database files, or browser authentication state.

## API compatibility

`/graphql` is a subset of the official Linear GraphQL API, not a renamed REST API. Supported operations must keep Linear's field names, argument names, input and output types, nullability, connection pagination, and error envelope. Pin the upstream schema, compare the supported contract in CI, and test real operations through HTTP. Reject unsupported fields instead of returning invented values or silently dropping input. Do not claim the entire Linear SDK is supported unless all generated selections it uses are implemented and tested.

The internal REST API may expose tickets-app-specific features. Both transports use the same authorization and domain services; neither bypasses workspace boundaries, audit history, module gating, or transactional writes.

## Frontend and design

Use React, shadcn-style owned components on Base UI, and Feature-Sliced Design: app > pages > widgets > features > entities > shared. Import slices through their public index; do not import up or across the same layer. Keep server state in TanStack Query, UI preferences in Zustand, navigation/filter state in the URL. Read DESIGN.md before UI work. DTCG JSON is the executable token source; generated CSS and TypeScript must agree with it.

## Security and operations

Use parameterized SQL, workspace-scoped lookups, server-side access controls, expiring hashed API tokens and sessions, signature-verified webhooks, transactional inbox/outbox, and private object storage. Never seed demo credentials into production. Production database migrations are explicit and tested separately. Report deployment and integration configuration blockers precisely; never describe a configuration file as a completed deployment.

Agent skills and generated design context belong under `.agents/`, not a separate `agents/` directory.

## Current page-first UX contract (2026-09-10)

For all entity UI work, read `.agents/skills/reference-led-product-ui/SKILL.md` and `.agents/design-context/linear-references.md` before implementation. The user's current requirement supersedes older create-dialog, Preview/Markdown-tab and global Save-bar examples: open the object page directly, place editable placeholders in its final layout, and edit title, body and properties inline. New and existing objects must share the document/editor primitives. Apply this consistently to issues, epics, projects, cycles, milestones, labels and saved views; authentication and destructive confirmations are separate categories. Retain safe drafts, idempotent creation, permissions, version conflicts and accessible controls.

Do not describe this design contract or the old green screenshots as a completed UI rewrite. Implement and verify the behavior before updating visual baselines or claiming fidelity. Official Linear sources and evaluated external design skills are linked in the design context; no external skill overrides the product brief.

## Forgejo release operations

Active source: `https://git.hyperide.ai/ultrabricks/tickets-app`. Use the authorized `fj` account and normal Git credentials; never extract stored tokens or bypass a git review hook. The GitHub publisher and source-recovery workflows are retired. `scripts/configure-deploy.mjs` now refuses CLI writes; its pure legacy functions remain only for regression compatibility.

Read `docs/OPERATIONS.md` for the exact existing Vercel project and explicit Neon initialization boundary. Do not create a second project or publish an old GitHub snapshot. `health` is liveness; `ready` requires the exact schema and an owner. Never claim a successful build or candidate URL is an authenticated working service. Production migrations/bootstrap await explicit operator approval; no demo accounts or user-data resets in production.

## Mandatory session continuity

Before every new user request, including «продолжай», read `docs/AGENT-SESSION-SAFETY.md` and `docs/WORK-CHECKPOINT.md`. They distinguish observed connector/test failures from unproven causes of `Thinking failed` and identify the current worktree and next incomplete gate.

Use one writer and one active browser suite per worktree. Keep outputs bounded, persist verification/checkpoint evidence, honor tool denials without workarounds, and avoid rapid retries after throttling. Follow review → fix → verify → merge → deploy → canonical-service verification. Never treat an interrupted command, old green test run or readiness endpoint as completed acceptance.
