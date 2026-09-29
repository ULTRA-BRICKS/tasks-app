# Current Tasks handoff pointer — 29 September 2026

This tracked file is a pointer, never the live state. Canonical live state is OUTSIDE Git: `/Users/ultra/xp/.tasks-work-evidence/tasks-app-continuity/CURRENT.md` (human view) and `CURRENT.json` (machine view). A branch checkout can replace this file with an older snapshot; compare the recorded worktree, branch, HEAD and source fingerprints there with live Git before resuming.

Snapshot when this file was last committed:

- Inline start/due date calendar (UB-41) was rebased onto `origin/main` f87b126 without content drift (patch hashes and staged tree recorded in the canonical record) and released through a reviewed Forgejo pull request together with the isolated per-browser test runner.
- Gates on the integrated tree: `bun run check`, `typecheck:tsc`, `check:secrets`, Storybook, isolated Chromium and WebKit acceptance, and the visual suite. Exit codes and logs live in `/Users/ultra/xp/.tasks-work-evidence/resume-20260927/r3-*`.
- UB-41 stays `in-review` until a deployment is verified; nothing in this change was deployed.

Before any new request, read `docs/AGENT-SESSION-SAFETY.md` and `docs/INTERRUPTION-RECOVERY.md`. Use one writer and one active browser suite per worktree, bounded outputs, no watched-file writes during browser tests, and a checkpoint in the canonical record after every completed gate.
