# tickets-app

A modular, open-source issue tracker inspired by Linear. Built for a small team, with React, Base UI, an API and a CLI. Public source code does **not** make workspace data public.

> **Development status:** the application source is being restored to this repository in independently reviewable commits. A successful dependency installation is not a successful application build. See the actual [Actions results](https://github.com/alex-mextner/tickets-app/actions) before deploying. No production URL is verified yet.

## Product scope

Issues, configurable workflows and labels, assignees, Markdown descriptions and comments, projects, milestones, epics/sub-issues, cycles, dependency relations, private attachments, saved views, activity and notifications. GitHub and Slack integrations use signed webhooks and durable delivery queues.

## Engineering contract

- **Bun** is the package manager, application/CLI runtime and unit-test runner. `bun.lock` is the only dependency lockfile.
- **Oxc** supplies linting, formatting and the Vite/Rolldown transform pipeline. Type checking remains a separate required check.
- **React + Base UI**, owned shadcn-style components, and Feature-Sliced Design. Server state belongs in TanStack Query; UI preferences in Zustand; navigation and filters in the URL.
- **DTCG JSON** is the executable source of design tokens. CSS and TypeScript are generated and checked for drift.
- **PostgreSQL** in production; isolated SQLite databases for local development and tests. Production must not silently fall back to SQLite or demo credentials.
- **`/graphql` is a supported subset of Linear's API**, not an alias for REST. Field names, argument/input types, nullability and connections are checked against the pinned official schema under `vendor/linear`. Unsupported operations must fail explicitly. Full Linear SDK compatibility is not implied.
- Atomic commits, unit/integration tests, Storybook, browser E2E tests and real screenshots. No source archives or static mockups are accepted as a deployed application.

## Publication and verification

The complete runtime, generated files, tests and operating instructions are being committed next. Screenshots will be captured from the running React application and stored in `docs/screenshots/`; they will be embedded here once available rather than replaced by design mockups.

External credentials must be configured separately for PostgreSQL, private object storage, GitHub, Slack and Vercel. Never commit `.env.local`, API tokens, database dumps or browser authentication state.

See [AGENTS.md](AGENTS.md) for the contributor contract.

## Attribution

This is an independent implementation, not a Linear product. The pinned Linear schema retains its upstream license and provenance under `vendor/linear/`.
