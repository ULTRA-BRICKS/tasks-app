# Tasks interaction continuation — 17 September 2026

User reassigned content migration to another agent; do NOT touch its branch, staging, source snapshot or production import. This worktree is /Users/ultra/xp/tasks-keyboard-20260917, branch fix/keyboard-and-login-20260917, based on3da8c2a. Current scope: login Enter/autofill, readable history, contextual menus and keyboard usability.

Public synthetic interception showed Enter submits normally from manually filled inputs in Chromium/WebKit. A reproducer with DOM autofill values but no React change event failed in both browsers; login now uses named FormData fields and an immediate submission guard. Six login tests passed after the change. Email handoff reads the form as well; no real sign-in/reset/email was attempted.

Mobile references recovered from Library: original file_000000005c7c81f482be85a66ffc450b, 50 pages. Copy saved to /ultra/Tasks UI references/mobile/Linear mobile.pdf; desktop folder alongside. Byte materialization was unavailable; no false pixel-diff score. A later concurrent-writer handoff reports the desktop ZIP saved in that Library desktop folder. No original reference files belong in Git.

New activity presenter resolves source status/person/project labels in bounded workspace-scoped batches and exposes readable summary while preserving raw event data. Frontend no longer displays internal action identifiers. Shared ContextActions gives the same commands through visible ellipsis, right-click and Shift+F10; existing issue/project PressPreview keeps its actions and long-press behavior.

Concurrency discovered: a density agent had written into this same worktree. That writer stopped and moved to tasks-density-20260917 (see DENSITY-WRITER-HANDOFF.md). Preserved the complete diff and alternatives at ~/xp/.tasks-work-evidence/keyboard-20260917, restored only density-owned files to this branch's base, and removed duplicate ContextActions. Do not merge/deploy density edits from here.

The independent writer also left real team CRUD routes/schemas that call the new teams.mjs. Those routes are present; validate them before release. Team-navigation currently uses the tested reversible hide/show context menu. A more complete TeamRow (rename/delete) exists as an unused row.tsx, copied from that writer's alternative. The attempted index integration was rejected before execution and is NOT applied. Do not describe UI deletion as working yet. No live team was deleted/renamed by this agent.

Earlier tool denials: new keyboard bindings.ts creation and compound team route registration / knowledge-row menu edits were denied before execution. Do not recreate a blocked operation via another transport. Unused keyboard registry.ts is a scaffold, not configurable-hotkey implementation. Keep the unrelated code changes as independent completed work.

Most recent completed verification: /tmp/tasks-ux-check2.log source/build179unit passed; /tmp/tasks-ux-context2.log12targeted Chromium/WebKit cases passed. Those results precede density separation and latest team route tests. No commit/merge/deployment yet. Re-run the current source/tree, inspect remaining browser tests, do ordinary review and publish only the tested interaction subset. Do not stage inherited/pending scaffolds automatically.
