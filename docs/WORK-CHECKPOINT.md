# tasks-app checkpoint — 15 September 2026

Read AGENT-SESSION-SAFETY.md and the canonical SESSION-FAILURES.md before continuing.
Active worktree: `/Users/ultra/xp/tasks-app` (Git moved it from tickets-draft-safety-20260913; old path is no longer active).
Repository/origin: https://git.hyperide.ai/ultrabricks/tasks-app.git .
Active feature branch: `feat/tasks-account-recovery`.
HEAD/deployed rename: `8d0ad86219ba28f8882643e357cab07526ac5975`.
Pending restored feature index: `5bb52004f7c743e2a2a404026d15b4adb664657d` (50 files; preserved separately from release).

## Rename completed, not merely planned

Forgejo renamed in place; remote main verified identical before/after the name operation. Vercel project renamed tasks-app; IDprj_BicxQsqDlb394HzvMuXZKB883EdY unchanged. Normal rename PR #2 merged.
A rename-only index was isolated from main, reviewed and tested independently.155 unit checks, source/build/types and86 Chromium/WebKit cases passed. Normal review task TASKS-RENAME gate passed2 iterations/3 distinct roles. Working lockfile corrected to match the reviewed index; no secrets/hooks/quotas changed.
Deployment is `dpl_DwJNEc8VAhfhCMGVQw9VHf8EiNjL`, hostname tasks-g2il79sud-inventorems-projects.vercel.app, from a clean git archive of merged HEAD. Public canonical origin retained: https://tickets-ultrabricks.vercel.app .
After promotion: login200 with tasks-app title and visible TASKS label in real Chromium; health200/tasks-app; ready200/ready; private me/issues401. Receipt posted to renamed repository PR2.
Logs: /tmp/tasks-rename-final-source.log, /tmp/tasks-rename-final-browser.log, /tmp/tasks-rename-final-review.txt, /tmp/tasks-rename-quorum.log, /tmp/tasks-rename-deployment.log, /tmp/tasks-rename-promotion.log, /tmp/tasks-rename-public-verification.json.

## Unfinished work preserved and NOT deployed

All pending draft-retention, Resend/reset and import-preflight staging was restored against renamed HEAD from the saved path list. Original backup is under refs/agent-checkpoints/tasks-rename-original-index and tasks-rename-index-backup.json in the worktree Git directory. Do not restore that old index blindly over the rename.
Combined pending-source check passed172 unit tests (`/tmp/tasks-restored-feature-check.log`); this does not prove missing reset acceptance or deployed features.

## Next concrete feature gates

1. Review finding from the previous account/draft panel: immutable ack records keep full submitted contents and grow clocks across submissions; reproduce and fix the reported quadratic storage growth without losing cross-tab causal acknowledgements. Report: /tmp/tickets-account-mail-review.txt, performance role. Do not convert this unresolved finding into a no-loss guarantee.
2. Successful password reset/expiry/replay/session-revocation integration cases still have no executed fixture test. A further test-file write in this turn was denied; no account-recovery-flow.test.mjs was created. Do not bypass tool refusals or substitute mail transport tests for account-security acceptance.
3. Keep passwords out of email. Backend Resend sender/key provisioning, migration4 and authenticated production round trips remain unperformed. No new user account, password change or email delivery occurred.
4. Read-only Linear snapshot/preflight is preserved under ~/.local/share/tickets-migrations/linear-glide-20260916; no import was applied. Document/initiative/import APIs and file-byte/history preservation need real acceptance before writes. Do not recreate source users as privileged accounts.
5. Original50-screen90%UI requirement remains unproven; passing internal screenshots is not reference parity.

The rename release did not touch cookies, CSRF, draft storage keys, canonical origin, credentials, existing database or backend migration state. Legacy internal names are intentional compatibility, not incomplete product metadata.
Do not re-run the finished rename release or move the worktree again. Continue the unfinished feature branch at the first failing acceptance gate.

## Current request: new canonical origin and self-service reset

User explicitly approved replacing the old site URL and does not need us to send a real email. Existing Vercel project now has verified tasks-ultrabricks.vercel.app; production APP_URL was updated for the next deployment. Old origins are not yet redirected; current deployments still use their previous environment.
To avoid shipping the known draft-journal growth blocker, isolated ONLY account-email/reset and canonical-origin changes in `/Users/ultra/xp/tasks-account-release-20260915`, branch release/account-recovery-origin-20260915, based on clean8d0ad86. This is the sole current release writer; original tasks-app index and draft/import work are preserved.
A new successful reset HTTP test passed using fixture() and in-memory mail transport: request link → consume proof → prior session denied → replay denied → login with new password. No production config or external email used. An additional concurrent/expiry-test append was denied and NOT applied.
Created Resend sending-only key named Tasks account recovery, scoped to verified invntrm.ru. Tool displayed it to the user. Attempt to save RESEND_API_KEY and MAIL_FROM to Vercel was denied; neither is claimed configured, no alternate secret-write route attempted, no email sent. Do not put the token in this document.
Single active suite PID97741 on release worktree: browser ports9391/5691, outputs account-origin; then Storybook, tsc and secret scan. Logs /tmp/tasks-account-origin-browser.log and related tasks-account-origin-* files. Wait for its exit before edits or another suite. Source checks previously passed with the new cron route and recovery page touch sizing.
Next: review isolated release; explicit migration4 gate and canonical deployment/redirect verification; keep missing provider configuration and absent requested account distinct from UI availability. Never describe an email queued flag as delivery.

## Verified end state — canonical origin is live

Canonical URL is now https://tasks-ultrabricks.vercel.app . Clean committed8d0ad86 was redeployed with the new APP_URL, deployment dpl_Dwor6oY13jXxWg5UUjt4mEDZBEEd (tasks-r4mapwtt2-inventorems-projects.vercel.app). Candidate health/readiness passed before promotion. New public login200, readiness200/ready and private me401 verified afterward, plus real Chromium mobile title/Email field. Repository website updated. No real login/reset or email submitted. Old-domain redirect write was denied; old URLs are not claimed redirected.
The account-only release worktree remains /Users/ultra/xp/tasks-account-release-20260915, branch release/account-recovery-origin-20260915, uncommitted. Current release-source gates passed163unit and independent types/build/secret checks;92Chromium/WebKit;18Storybook after bringing the already-reviewed semantic picker-close assertion;85isolated PostgreSQL checks including the successful reset HTTP and mail tests. This excludes unfinished draft-journal/import code intentionally preserved in the original worktree.
Current account service has not been published: the one normal GLM review returned429 for all three roles, no approval. Migration4 not applied to production. Resend sending-only key Tasks account recovery was created for invntrm.ru and shown once to the user, but Vercel secret/config write was denied before execution. No credential value belongs in this file. User/operator must install RESEND_API_KEY and MAIL_FROM=Tasks <tasks@invntrm.ru> in production before mail can work.
New successful test in tests/unit/account-recovery-acceptance.test.mjs covers request/mock delivery/reset, old session revocation, replay410 and new-password login in SQLite and isolated PostgreSQL. The additional concurrent/expiry/PAT test append was blocked and is absent; no claim of that coverage. Requested ultra@glide.vc production account remains unprovisioned, so a reset form alone must not be advertised as creating it.
Logs: /tmp/tasks-canonical-origin-deploy.log, /tmp/tasks-canonical-origin-promote.log, /tmp/tasks-account-origin-final-source.log, /tmp/tasks-account-origin-browser.log, /tmp/tasks-account-origin-final-storybook.log, /tmp/tasks-account-origin-final-postgres.log, /tmp/tasks-account-origin-review.txt. All commands ended; synthetic PostgreSQL container was started for tests and is being returned to its prior stopped state.
Next gate: ordinary review of the isolated account release, resolve actual findings and remaining security tests, authorized provider configuration, explicit migration4 and clean deployment; then user-triggered reset. Do not rerun or undo the completed origin change. No workaround for tool-denied secret/account writes.

## Latest continuation: reviewed account release merged

Account-only PR3 merged to origin/main10b0d32f734d2398d00e4c79de8ef41724c19f75. The sole release writer remains /Users/ultra/xp/tasks-account-release-20260915; its detailed checkpoint supersedes older account-release gates above. This original tasks-app worktree and its draft/import index were NOT rebased or overwritten.
Verified current account-only release:165unit,92browser,87isolatedPostgres and18serialStorybook; normal review gate passed2completed iterations across3roles. A default concurrent Storybook timing failure is recorded in ACCOUNT-RECOVERY.md, not suppressed.
Live origin already changed to https://tasks-ultrabricks.vercel.app, but recovery code is not deployed. Production Resend variables remain missing; the requested new account still has no membership. No email sent and no account/secret writes retried through alternate routes.
Neon migration4 is prepared and tested only on temporary branch br-royal-term-b13u3bwx; requires explicit user confirmation before apply/discard. Context JSON is in the release worktree docs/account-migration-prepared.json. Production schema3 unchanged. Ask for migration confirmation and operator sender/key configuration before publishing the merged release.
All processes started in this continuation completed; the temporary Neon branch is a retained preparation, not a running background task. Do not restart completed review panels or create another worktree.

## 16 September live-account handoff (supersedes older missing-UI/migration status)

The actual owner email is now ultra@glide.vc (same user ID and owner membership, no password changed). Production migration4 was applied through its prepared Neon workflow; temporary migration branch deleted. Current canonical https://tasks-ultrabricks.vercel.app serves clean main3d1310b26896b5df8881b6edd747c37dad3b8c33, deployment dpl_JAW8YxJ2K585pJiksnywKPgFtRt9. Forgot password link and /forgot-password form were verified in real public mobile Chromium without submitting a request. PR4 contains the publication receipt.
The earlier account release initially failed on a Hobby-incompatible minute cron; the reviewed minimal fix now uses daily maintenance, retaining request-triggered waitUntil. No plan upgrade.
Email delivery STILL not configured: RESEND_API_KEY/MAIL_FROM installation was blocked. New sending-only key Tasks production recovery 2026-09-16 was displayed once, not stored in backend. auth/options currently returns passwordReset:false. Do not advertise a working email flow or create another account. No actual mail or reset request was sent.
Authoritative latest details/logs: /Users/ultra/xp/tasks-account-release-20260915/docs/WORK-CHECKPOINT.md. All commands ended. The original unfinished draft/import tree here was not altered or published by that release.

## 16 September — continue independently of the denied mail-secret operation

Live /api/auth/options still reports passwordReset:false. MAIL_FROM was already installed, but RESEND_API_KEY installation was denied in the prior turn. No new key, alternate secret path, password reset request or real email attempted here.
Current sole feature writer: this existing tasks-app worktree, branch feat/tasks-account-recovery, base8d0ad86. Previous index and other worktrees preserved. The current production source/layout is later; do not deploy this old full feature tree or undo the published auth work.
Addressed the remaining journal-growth finding in source: receipt entries now identify an opaque copy revision rather than retaining the full submitted body. Receipt keys stay immutable but their clocks advance the page's existing actor, not a new actor per submission. Existing legacy receipt/body records remain readable. An unchanged adopted mirror retains its revision identity.
Added pure receipt regressions: three pass, plus seven causal-version tests (10/10). Attempted browser-budget test-file write was denied before execution, and that file is absent; no claim of running that test.
One verification task active: PID89009, source/types then focused Chromium/WebKit retention and performance cases, ports9581/5881, outputs receipt-retention. Logs /tmp/tasks-draft-receipts-source.log and /tmp/tasks-draft-receipts-browser.log. Do not edit source or overlap another suite while it runs.
Next: inspect concrete browser results, focused review of the receipt delta, then integrate only the draft feature with current main without overwriting the already shipped reset/layout work. Mail enablement and whole-Linear import remain uncompleted and are not inferred from these checks.
