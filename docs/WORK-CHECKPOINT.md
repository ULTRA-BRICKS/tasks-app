# Tasks release checkpoint — 25 September 2026

Current worktree: ~/xp/tasks-mobile-cache-20260924; branch fix/login-autofill-20260924; HEAD/main0f9ffd06b9f39ad90c10c1b4cb4bf3a88b9687f5. Mac56f7ee32-74a8-4650-8009-e23b1328e602. This checkpoint is an unstaged handoff only; published runtime is clean. Untracked rig.yaml belongs to another workflow and is not staged. Read AGENT-SESSION-SAFETY.md before continuing.

## Published and verified

PR25 People email invitations was finally promoted from its ready candidate. Canonical site had still served old assets before this continuation. The actual public People UI was checked with synthetic private API data in Chromium/WebKit at phone/desktop widths: email form and pending/accepted/expired rows are visible, no manual invitation-link field. No actual invitation email sent. Evidence: ~/xp/.tasks-work-evidence/completion-20260925/public-people/.

PR26 fixes login Enter/autofill, same-task duplicate submit, mixed edit/autofill state loss and recovery-email handoff. Code commit9a1b4de; merged0f9ffd0. Deployment dpl_PM9j3JH6ZRJKMh7SszGp56qTgNQe promoted to tasks-ultrabricks.vercel.app. Canonical assets index-RvtDlMLK.js/index-Df6_7A-v.css match the reviewed build.

Baseline4browser failures reproduced blank autofill payload and duplicate POSTs; WebKit recovery and mixed-input failures also reproduced. Final10focused cases pass. Whole exact-source gates:225unit passed/1pre-existing skip;90Chromium+90WebKit;20Storybook;6visual;independent types/build/secrets pass. Logs /tmp/tasks-login-shipping-*-sep25.log. Two completed review cycles confirmed runtime correctness/performance; small repeated-field-extraction readability suggestions remain optional, not covertly removed from the report. No baseline images or assertions were weakened.

Actual public login bundle was retested in Chromium/WebKit with synthetic intercepted rejections: native fields, one-flight guard, retry and email handoff verified. IMPORTANT: the initial WebKit diagnostic let its Service Worker bypass page.route; synthetic rejected login requests reached the real endpoint. No real user credentials were used. Do NOT claim those initial probes had zero requests. The corrected diagnostic blocks workers only in the isolated test context and intercepts ALL API calls; its receipt is ~/xp/.tasks-work-evidence/completion-20260925/public-login/receipt.json. Source: https://playwright.dev/docs/network#missing-network-events-and-service-workers . Worker/offline behavior is tested separately, not inferred from a worker-blocked mock test.

## Still open

Persistent authenticated workspace read models/offline contents, configurable comprehensive shortcuts/UndoRedo, long-press menu parity and Slack setup remain incomplete. Prior safety-rejected private-cache/keyboard/hold edits are preserved in external pending evidence; do not reroute them or describe them as installed. A dock focus/compaction edge is also pending. This continuation did not alter content migration, account roles, passwords or provider credentials. The other agent retains ownership of Linear migration/sync.

No owned review/test/deployment process remains active. PR25 andPR26 contain verification/promotion receipts. Next work is the unresolved product backlog, not another People/login redo or re-promotion of an older release.
