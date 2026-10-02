# Tasks current handoff — 18 September 2026

## DEPLOYED: input-aware density

PR9 is merged. Density commit7a5e6d3 was reviewed with the normal staged hook; merged runtime source1d3ac4d21d64e9ba77d4ccd05fdbe436e567f436 retains readable-history513c294. Production dpl_13eyTKbM9JxkqEaeFt9jMsNSTxiV / tasks-ikw4gd0b3-inventorems-projects.vercel.app promoted successfully.
Canonical tasks-ultrabricks.vercel.app assets match this exact build: index-CpdwexPM.js and index-BQ1SKH8w.css. ready200, passwordReset:true, anonymous issues401. Real public bundles were checked with synthetic intercepted private-API fixtures in Chromium/WebKit at393/680/1024/1440 widths:42px fine pointer,56px coarse;Compact36/48;visible1px separators;14px touch titles;no overflow;density persisted on reload. No live login, email, migration or content mutation.
Source/build/type checks on merged runtime passed183unit. Original density candidate had68Chromium+68WebKit,18Storybook,6visual comparisons; no claim that hosted Forgejo CI ran (Pending at merge). Source and post-promotion receipts posted to PR9. Before/after images,8 native-coordinate overlays/diffs and exact geometry JSON stay outside Git at ~/xp/.tasks-work-evidence/density-sep18/. These are release regression evidence, NOT90%Linear parity.

## MERGED: deterministic Storybook menu lifecycle

A fresh default test:ui run reproduced17/18 failure in Capsule actions/KeyboardAndSelection. Test now waits for actual semantic close and focus restoration before reopening, then awaits expanded state before Escape; no sleeps, disabled rules or extended timeout. Five normal sequential default runs each passed18/18.
Ordinary3-role review completed with no findings. Commit0a87886/PR10 merged as mainb9b26c812f9c5bfaf559071d10682299cd4a2b42. Only a6-line story-test change differs from deployed runtime1d3ac4d; no extra runtime deployment needed.
Current local branch is test/storybook-menu-lifecycle-20260918 in this SAME worktree; HEAD0a87886. Preserve untracked pending login helper/tests listed below. Original tasks-keyboard and migration worktrees untouched.

## OPEN: reproduced Enter/autofill defect

Added12browser checks; baseline6pass/6fail (three cases in both engines): silent DOM autofill submission, same-tick duplicate submission, autofilled email transfer to Forgot password. Ordinary manual Enter and required-field checks pass. Log /tmp/tasks-login-red-sep18.log. No actual production credentials/login were used.
The proposed source integration was rejected before execution; read-back confirmed src/pages/auth/ui.tsx unchanged. Do not reroute that rejected operation or claim a green login fix. Untracked src/shared/lib/login-fields.ts and tests/unit/login-fields.test.ts have4pure unit passes, but helper is not wired into the app. tests/e2e/login-keyboard.spec.ts intentionally remains red and is not committed/deployed.

## Other acceptance / references

Private originals are in Library /ultra/Tasks UI references/{mobile,desktop,feedback}; desktop27PNGs and mobile50-page PDF. Representative source screenshots were re-inspected; external REFERENCE-AND-ACCEPTANCE-AUDIT.md records concrete mismatches (right-side searchable shortcut panel, actual G-I Inbox binding, keycaps, navigation customization, context menus). Full-reference90%parity, configurable shortcuts and complete team/saved-view context menus are not completed.
Expanded draft branch remains separate. Its last review has incomplete security/correctness verdicts and a performance finding involving repeated acknowledgement when storage is unavailable; its last whole-browser run is not fully green. Do not merge it on older test counts. Content migration belongs to the other agent and was not repeated.
All processes started in this continuation are complete. No automation/background job left running. Next bounded work is the unfinished login integration/review and keyboard/context-action acceptance, NOT another density redo or content import.
