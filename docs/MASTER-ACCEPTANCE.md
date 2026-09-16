# Tasks — complete user acceptance register

Updated 16 September 2026 from the user's requests in this Tasks conversation. This replaces scattered completion claims, not the implementation roadmap. Adjacent Conloca, StateIR, HyperIDE Canvas and boards-app requirements are NOT silently treated as Tasks requirements.

## Current user priority

The latest phone screenshot shows a poorly placed recovery link and inconsistent authentication-page rhythm. Finish the shared login/recovery/invitation layout, validate it in real browsers, then publish the exact reviewed source. Do not call a screenshot or test file a shipped improvement.

| User requirement | Current evidence / acceptance still needed |
| --- | --- |
| Rename product and repository to tasks-app | Shipped. Repository `git.hyperide.ai/ultrabricks/tasks-app`; project ID retained. |
| New site address | Shipped: `https://tasks-ultrabricks.vercel.app`. Old-address redirect is not verified. |
| Replace old owner email with ultra@glide.vc | Applied to the same owner ID/membership. No password printed or changed. |
| User can request/reset password in the UI | UI/API/migration4 shipped in main3d1310b; sender configuration is still a LIVE blocker, not a code-completion claim. |
| Resend in Tasks backend | Encrypted queue, single-use reset links, retries and invitation messages implemented/reviewed. RESEND_API_KEY/MAIL_FROM installation was denied; don't route around the denial or send test mail. |
| Do not send a real email on the user's behalf | Preserve. Inspect options/UI without submitting reset or invitation requests. |
| Current login looks wrong | Active auth-layout branch: separate password/recovery label row, consistent shared shell, readable controls, bounded form width and safe mobile scrolling. Must pass visual review and ship. |
| Follow the user's 50 Linear reference screens, not merely a theme | OPEN. Original PDF not available in retrieved files. Available public references and same-state overlays must be scoped; no invented 90% score. |
| 90%+ UI likeness across relevant screens/states | OPEN. Need coverage matrix for issue list/detail/new, projects/cycles, mobile navigation, pickers/menus, settings and gesture states. Internal regression baselines do not measure reference parity. |
| Create issues as the actual inline document, not a separate form | Core issue/project/cycle document flows shipped. Audit other entity creation for remaining form-style exceptions. |
| Native-like motion; long press, preview, slide-and-release; selectable text | Core issue/project previews, cancellation, keyboard and selection regressions shipped. Full touch-state parity with supplied PDF remains unverified. |
| Keyboard navigation without disrupting text input | Core commands and modal isolation tests shipped; include new controls in regression coverage. |
| Never lose entered-but-unsent work | OPEN RELEASE. Expanded journal/recovery work is preserved in `~/xp/tasks-app`, not all deployed. Independent drafts, per-copy acknowledgements and no overwrite on late responses require final growth/security review. |
| sessionStorage or equivalent for unsent inputs | Ordinary text/input drafts must be scoped by workspace/account/document; durable recovery/export and visible storage-error feedback are required. Passwords/tokens are deliberate exclusions. |
| Preserve pending file uploads | OPEN. Incomplete IndexedDB draft is outside executable source. Do not claim browser-cleared/device-lost data is recoverable without a backup. |
| Import the whole connected Linear workspace | Snapshot verified outside repo:1701 issues,1307 comments,12 projects,7 milestones,1 initiative,3 documents,744 issue relations,5229 history entries,1022 attachment/link metadata. No target import applied. |
| Verify complete functionality and API before import | OPEN. Document/initiative and idempotent plan/apply APIs, authors/timestamps, source-ID mapping, private file bytes, backup/rehearsal and reconciliation must exist before writes. No silent partial import or privilege grants. |
| Finish reviews, fixes, merge, deploy, verify service | Every released increment must identify source SHA, gate outcomes, candidate and canonical public/browser checks. Hosted CI Pending is not a hosted CI pass. |
| Avoid repeated interruptions; remember decisions | Read AGENTS.md, session-safety register and current checkpoint. One writer/suite, bounded logs, preserve prior work, no review/permission bypasses. |

## Exact behavioral targets retained from the original requests

The supplied reference description calls for near-black surfaces, quiet contrast, compact rows with clear group spacing, pill actions, a floating mobile dock and a separate contextual create action. New issue means the issue page itself with inline title/description/properties, not an unrelated creation form. Long-press must support preview, sliding to an action and releasing without lifting beforehand; movement/cancellation must not trigger an unintended action. Text stays selectable except actual controls/drag handles. Desktop commands include j/k, Enter, Escape, Cmd/Ctrl+K and selection, without intercepting typing.

All unsent states matter, not only issue descriptions: new/existing issue/project/cycle text, comments, property intent, date pickers, relation targets, saved-view names and editable settings. A late acknowledgement may clear only the submitted revision. Different tabs/accounts/workspaces must not overwrite each other. Export/recovery and explicit storage-failure feedback are required; browser eviction, device loss and secret fields must be described honestly rather than covered by an absolute guarantee.

For import, “whole Linear” includes archived work, original identifiers, descriptions, authors, project/cycle/milestone mapping, labels/statuses/priorities, comments, dependencies, history, documents/initiatives and private attachment content. A verified export is not a loaded application. Source users are attribution records unless login access is deliberately provisioned.

## Delivery sequence after this screenshot fix

Finish and publish the bounded auth-layout change first. Then unblock actual user-triggered reset through an authorized sender configuration; finish the preserved draft-journal acceptance; implement missing import functionality and rehearse/import/reconcile; perform paired-screen Linear parity work with the original references. Do not repeatedly rebuild completed UI work while a different gate is blocked. Keep final source, tested tree, actual deployment and remaining gaps separate in each receipt.

The corresponding security/account migration is already deployed: do not reset the database, recreate the owner, send unsolicited test email or silently upgrade hosting merely to make this register green.
