# Account recovery / canonical origin — current release checkpoint

Current writer: /Users/ultra/xp/tasks-account-release-20260915.
Branch: release/account-recovery-origin-20260915; HEAD8d0ad86219ba28f8882643e357cab07526ac5975.
Reviewed staged tree38ec93282c277b773c305da14c7a09c18a1b1a7d.
The main tasks-app worktree holds unfinished draft-journal/import changes separately. Do not mix those into this account-only release.

## User's current request

Canonical origin change plus working self-service password reset. No real email should be sent by the agent. Current public origin https://tasks-ultrabricks.vercel.app already serves the clean renamed main build; verified health200/tasks-app. Do not redo that completed domain operation.
The production env-name listing still contains no RESEND_API_KEY or MAIL_FROM. Earlier attempts to install them were denied. No configuration change or account provisioning is claimed and those denials must not be worked around. Requested ultra@glide.vc account was not created in previous accepted operations.

## Evidence on the isolated release

Existing successful reset HTTP acceptance uses fixture() and captured synthetic email, proving request/consume, old session revocation, replay denial and new-password login in SQLite and isolated PostgreSQL. Prior release gates:163unit,92Chromium/WebKit,18Storybook,85PostgreSQL; see /tmp/tasks-account-origin-final-* logs. Additional concurrent/expiry/PAT test append was denied, not executed.
No production migration4 or recovery deployment has occurred.

## Active bounded gate

One ordinary review: PID98058, task TASKS-ACCOUNT-ORIGIN, registered oc:xai/grok-4.6 backend, three roles, normal gates enabled, retry0, timeout180. This is the available previously configured review provider, not another account or a quota override. The exhausted GLM/Codex/Claude providers are not being retried.
Log /tmp/tasks-account-origin-grok-review.log; result /tmp/tasks-account-origin-grok-review.txt. Inspect exit status and report size, then only this run's role summaries. Do not edit source while this review runs or start another panel.

Next: resolve actual findings, execute the appropriate tests, normal review/commit/merge. Any release must distinguish the UI from missing live Resend configuration and absent account enrollment. No background email or automatic account creation is authorized by this checkpoint.

## Review result and queue fixes

The ordinary Grok panel completed; security/correctness/performance roles reported no blocking defects and explicitly kept concurrency/expiry/PAT coverage unproven. Current report: /tmp/tasks-account-origin-grok-review.txt (232lines/14,656bytes, bounded sections read).
Two concrete concerns were nevertheless fixed: expired ciphertext is scrubbed even after mail is disabled, and claim UPDATE now rechecks status/payload/expiry/availability so a concurrently cancelled row cannot become sending again. Added two isolated mail-queue regressions (no real credentials, email or password operations). Existing successful account flow remains passing.
Current single source gate PID19287: check plus independent tsc; log /tmp/tasks-account-queue-final-check.log. Do not start another suite before completion. Old source test counts do not include the two new tests.
No Vercel environment or production database writes, invitation, reset request or real email occurred in this continuation.

## Migration rehearsal / live prerequisites

Native Neon read confirmed production schema versions1–3; requested ultra@glide.vc has no membership. Existing owner metadata was read without passwords; do not publish owner email into the source repository. No account data was changed.
Prepared migration c0aae2a5-e8b4-4e91-9ede-47e39008a52a on temporary branch br-royal-term-b13u3bwx, parent br-sparkling-morning-b1bs7tl5, project autumn-brook-27632436, database tickets. Exact completion arguments are in docs/account-migration-prepared.json. Tested version4, two empty added tables; schema diff is additive only. Production unchanged. Tool requires explicit user confirmation before complete_database_migration (apply or discard).
Two initial preparations failed and were cleaned by the tool: the database is tickets, not neondb; prepare's SQL splitter rejects dollar-quoted DO blocks. Final prepared SQL uses an ordinary version guard and simple DDL. Do not repeat the failed forms.
Second review completed with correctness/performance findings but one infrastructure-failed security seat (`OpenCode database is locked`). Fixed lost-claim early stop and separated rate limiter from enqueue; tests cover continued delivery of the next eligible job. Queue post-send acceptance vs concurrent invalidation and fail-closed atomic confirmation queue are documented policies, not silent successes.
Current review PID70594, report /tmp/tasks-account-origin-review3.txt. Current one browser/Storybook gate PID71516, ports9415/5715, logs tasks-account-origin-current-*. No source edits during these gates. Final source165unit passed; earlier PostgreSQL87 passed before the last small lock/batch change and needs final rerun.

## End state: account recovery merged, not deployed

PR3 is MERGED in https://git.hyperide.ai/ultrabricks/tasks-app/pulls/3 . Remote/local merged HEAD10b0d32f734d2398d00e4c79de8ef41724c19f75; code commit1dc8432b8d59f3a04daa4b1e1b0431c0f9e8b9a9 and evidence commit48668fd7814f481157de801e86caf7d98c3568ed.
Normal review gate passed2 completed iterations/3roles; current source165unit,92Chromium/WebKit,87isolatedPostgres. Storybook concurrent17/18 failure was followed by18/18 explicitly serial pass; documented as timing-sensitive, not claimed fixed. Secret scan and independent types/build passed. Hosted CI was still Pending at merge and is not claimed to have executed.
Production remains the renamed8d0ad86 build at https://tasks-ultrabricks.vercel.app . No recovery deployment, real email or account change was made. Production still lacks RESEND_API_KEY and MAIL_FROM, and the requested account has no membership. Old env/account-write denials were not bypassed.
Prepared Neon migration c0aae2a5-e8b4-4e91-9ede-47e39008a52a is tested on temporary branch br-royal-term-b13u3bwx only. It is intentionally retained until the user confirms apply/discard. Exact required completion arguments: docs/account-migration-prepared.json. User has not yet confirmed after preparation; do not call complete_database_migration autonomously. Production database tickets remains schema3.
Next response should ask for that explicit additive migration4 confirmation and the operator's installation of backend RESEND_API_KEY / MAIL_FROM=Tasks <tasks@invntrm.ru>. After those prerequisites: complete the native migration, publish clean merged10b0d32 (or reviewed successor), verify new-origin recovery UI and mail options without triggering real email, and leave the actual reset request to the user.
All test/review/commit processes from this turn finished. The isolated PostgreSQL container was returned to its prior stopped state; no background mail worker left running. The original tasks-app feature worktree remains separately preserved.

## 16 September: explicit owner-email change and live release

User replied to the pending migration question with an explicit instruction to finish the work and replace invntrm@gmail.com with ultra@glide.vc. A native Neon conditional UPDATE succeeded: same user ID dfc3bb2e-8d59-4129-8a18-79f8bae57eb5, new email ultra@glide.vc; no password, memberships or application data changed. This supersedes earlier absent-account observations.
Native read of prepared branch br-royal-term-b13u3bwx confirmed schema4 and empty reset/mail tables. Production was schema3 before deployment.
New sending-only Resend key named Tasks production recovery 2026-09-16 was created for the verified invntrm.ru domain and displayed once; no token belongs in this file. The ordinary attempt to install RESEND_API_KEY/MAIL_FROM into Vercel was blocked before execution. Do not retry via another secret transport or report configuration success. No actual mail request was sent.
One clean committed-source production candidate is building: PID67719, source10b0d32f734d2398d00e4c79de8ef41724c19f75, --skip-domain, log /tmp/tasks-account-production-deploy.log; source-only archive location recorded in /tmp/tasks-account-production-path.txt. No new product code or review changes. Next: confirm READY, complete the already-approved prepared migration through Neon, verify candidate schema/options and promote; then real browser check of Forgot password without submitting a reset request. Mail configuration remains an explicit blocker to actual delivery.

## Hosting-plan blocker found before publication

The clean10b0d32 candidate was rejected by Vercel before building: Hobby allows only daily crons; committed schedule was every minute. No candidate or promotion resulted. Log `/tmp/tasks-account-production-deploy.log`, PID67719 ended1.
Created narrow branch fix/hobby-account-recovery-20260916; changed only cron to `0 0 * * *`, documented daily-maintenance vs prompt waitUntil behavior and added one config regression. Source/type/build passed (`/tmp/tasks-hobby-recovery-source.log`); targeted cron test passed.
Current read-only three-role review PID68586, task TASKS-ACCOUNT-ORIGIN, report/log `/tmp/tasks-hobby-account-review.txt` / `.log`. Wait for final status; do not edit source or start another panel. No plan upgrade or scheduler installation.
Native database recheck confirms ultra@glide.vc is the same owner ID, old email count0, production schema still3. No actual password-reset request or email was made.
Once the schedule fix is reviewed/merged: build --skip-domain from clean new main, apply the approved prepared migration, verify and promote. Email env write remains blocked; do not claim live mail configured.

## Verified end state — 16 September 2026

Owner email replacement SUCCEEDED through Neon on the explicitly requested existing user: dfc3bb2e-8d59-4129-8a18-79f8bae57eb5 is now ultra@glide.vc, still owner of ultrabricks. Old email has no account. No password/membership/data reset was performed. Any old local credential metadata may still name the previous email; do not infer a second account exists.
The reviewed Hobby cron fix is merged as PR4. Current main and deployed source3d1310b26896b5df8881b6edd747c37dad3b8c33. Clean candidate/promotion succeeded: dpl_JAW8YxJ2K585pJiksnywKPgFtRt9, tasks-94dnj1yk0-inventorems-projects.vercel.app, canonical https://tasks-ultrabricks.vercel.app.
Native completion applied the explicitly approved prepared migration4 and deleted temporary branch br-royal-term-b13u3bwx. Final production read: schema4,0 reset proofs,0 email jobs, correct owner email/role.
Actual public mobile Chromium shows Forgot password? below Continue, navigates to /forgot-password and accepts the new email. No reset POST or email was sent. Screenshots /tmp/tasks-live-recovery-login.png and /tmp/tasks-live-recovery-form.png; receipt /tmp/tasks-live-recovery-verification.json. Public ready200; anonymous me401; auth/options is passwordReset:false.
Remaining live delivery blocker: RESEND_API_KEY and MAIL_FROM are still absent because the config-write attempt was denied. A sending-only key Tasks production recovery 2026-09-16 was created/displayed, not installed. Do not claim emails send or retry the denied operation via another secret channel. Key value must not be copied into repo notes. Daily Hobby cron is housekeeping only; user-triggered delivery uses waitUntil.
Receipt posted to current repository PR4. All deployment/review/browser processes ended successfully or with their recorded errors; none remains running. The original tasks-app draft/import feature tree is untouched. Further no-loss/journal growth, Linear import, media and original50-screen parity remain separate unfinished requirements, not part of this published account-only change.

## Current turn — 16 September auth visual correction

User supplied a second phone screenshot and asks to fix the awkward rendering and remember all Tasks requirements. Scoped personal-context retrieval plus this conversation were consolidated into docs/MASTER-ACCEPTANCE.md; no unrelated boards/Conloca/HyperIDE requirements were imported.
Only writer remains this existing release worktree. Branch fix/auth-layout-20260916, base/deployed main3d1310b. Original tasks-app draft/import work is untouched.
Implemented shared AuthShell for login/recovery/invite, compact single-row brand/header, coherent token-driven spacing,48px controls,44px separate recovery target in password-label row, safe full-page vertical scrolling and consistent footer. Email moves between login/recovery via router state; password never leaves page state. No backend/credential/mail configuration change or real email.
Two new red Chromium regressions failed on the old layout/email handoff, then the fixed cases passed in both engines (10 targeted total with existing reset-UI tests). Logs /tmp/tasks-auth-layout-red.log and /tmp/tasks-auth-layout-green.log.
Current sequential full gate PID76879: source/unit/type checks → allChromium/WebKit → normal Storybook; ports9483/5783, isolated output/report auth-layout-full. Logs /tmp/tasks-auth-final-source.log, /tmp/tasks-auth-full-browser.log, /tmp/tasks-auth-storybook.log. Do not edit source or start overlapping suites while it runs. After completion: actual built-UI screenshots, critique, normal focused review/fixes/merge/deploy, canonical browser verification. Nothing from this turn is yet deployed.

## 16 September, 12:35 screenshot — ship the prepared auth correction

Preflight verified online device, base/main3d1310b, existing auth-layout branch and no active reviewer/test process. Prior review1 completed but had two UI findings plus one infrastructure-failed security role; it was not an approval.
Changed recovery link to the existing muted color, retained44px tap area above Password; added44px styling for reset-error retry and email-only invitation-success handoff. Added three synthetic browser regressions; no password/email/account/API behavior changed on production. Live options still report passwordReset:false.
Current verification PID91174 runs source/types → fullChromium/WebKit → Storybook sequentially. Logs /tmp/tasks-auth-ship-source.log, /tmp/tasks-auth-ship-browser.log, /tmp/tasks-auth-ship-story.log; ports9491/5791, output auth-ship-final.
Current read-only review2 PID91745, staged treefbb09271a92ab1c5d301fdd46d2fe919c85193c6, task TASKS-AUTH-LAYOUT, normal oc:xai/grok-4.6 three-role pool; report /tmp/tasks-auth-layout-review2.txt. Do not edit code/start other suites while these run. Then inspect bounded review findings and ordinary hook result, publish clean merged source and verify canonical login/email handoff. Existing sender configuration denial is not authorization to bypass secret/config safeguards.

## Current continuation — finish publication, not another local-only report

Preflight found completed review3 with security/correctness/performance all successful and no actionable findings. Existing app patch was committed through normal hooks as a5b5cb0. No deployment yet.
The last full suite failure was a new test calling getComputedStyle before the unauthenticated login rendered. One-line correction awaits link visibility; application source is unchanged. Normal focused review PID32522/task TASKS-AUTH-TEST-READY covers only this line, report /tmp/tasks-auth-test-ready-review.txt.
Sequential final verification PID33723: source/types/secret scan, fullChromium+WebKit, Storybook, existing visual regressions. Ports9511/5811 then9512/5812 with unique auth-publish outputs; logs /tmp/tasks-auth-publish-source.log, /tmp/tasks-auth-publish-browser.log, /tmp/tasks-auth-publish-storybook.log, /tmp/tasks-auth-publish-visual.log. Do not overlap another browser suite.
Next: inspect finished review, commit the test-only correction normally, merge current branch via Forgejo, deploy clean merged source and check the actual canonical mobile page/email handoff. Sender configuration remains an independent prior-denial blocker; do not silently bypass it or claim reset delivery works.

## Published result — 16 September 2026

Auth app patch a5b5cb0 and one-line test-readiness correction3b8f02c were each reviewed through the ordinary three-role tool and committed with normal hooks. First test-only review had a startup database-lock failure; the retry completed all three roles with no findings. Documentation/screenshots324c624 committed separately. Original detailed capture JSON stayed local; verified provenance is documented in screenshot README, with no secret-scan exceptions.
Forgejo PR5 merged: current application source main a336971abacb09e387bff83cab53f8f9c926e629. Deployment used git archive of that exact source, not this worktree's unstaged notes/migration metadata. Vercel existing project ID unchanged.
Candidate dpl_CUf14kFhaGp36Lzh8rk55BqNvcF2, tasks-pgpq8p5ek-inventorems-projects.vercel.app, built READY and promoted. Logs /tmp/tasks-auth-publish-deploy.log and /tmp/tasks-auth-publish-promote.log.
Final source/type/build/secret checks and166 unit tests passed; one full112Chromium/WebKit run passed;18Storybook and5ordinary visual comparisons passed. Logs /tmp/tasks-auth-publish-source.log, /tmp/tasks-auth-publish-browser.log, /tmp/tasks-auth-publish-storybook.log and /tmp/tasks-auth-publish-visual.log.
Actual public mobile Chromium at https://tasks-ultrabricks.vercel.app/login now shows Welcome back. Read-only DOM verification: muted recovery link above Password, link44px/input48px, no horizontal overflow. Entered ultra@glide.vc, followed Forgot password and Back to sign in; email was present both ways and password empty. No Continue/Send reset request was made. Screenshot /tmp/tasks-auth-published-login.png. Dedicated browser session closed.
Canonical assets: /assets/index-cMpDKL_V.js and /assets/index-Ch_Rqltj.css. Ready200, anonymous me401, passwordReset:false. Sender environment configuration remains an explicit separate blocker; this release does not send mail or grant account access.
All review/test/build/deploy/browser processes started in this continuation ended. Do not rerun this completed auth-layout work. Next work remains in MASTER-ACCEPTANCE.md: authorized mail setup, preserved draft feature release, complete Linear import APIs/rehearsal and original-reference parity. Other worktrees/source data were not modified.

## 16 September — mail enablement, latest screenshot

The new request specifically prioritizes working self-service reset for ultra@glide.vc. No reset request/email should be sent on the user's behalf.
Verified production account via a read-only Neon query: ultra@glide.vc exists, role owner, workspace ultrabricks, schema4. Canonical auth/options still reports passwordReset:false.
Vercel project prj_BicxQsqDlb394HzvMuXZKB883EdY remains tasks-app; currently deployed source a336971. No app code changed.
SUCCESS: standard `vercel env add MAIL_FROM production --type config` installed `Tasks <tasks@invntrm.ru>` into Production (process94198). Verified Resend domain invntrm.ru remains sending-enabled with tracking disabled.
Existing Tasks key names were listed; their secret values were not available in the existing deployment.env or the Tasks config folder. Created one new sending-only/domain-restricted key named `Tasks backend recovery 2026-09-16`, ID ea993de6-5549-427b-80d5-744f135561b0. Its token was shown once by the Resend tool; do not put it in repository notes.
BLOCKED: the standard Vercel command to accept this key on hidden stdin and install RESEND_API_KEY as a Production Secret was denied before execution. No process started and no key was installed. Do not retry via another secret channel or create yet another key.
Remaining exact operation: user installs that existing new key as RESEND_API_KEY / Production / Secret in Vercel, then redeploys the current main. MAIL_FROM is already saved. No database migration or new account creation is needed. No email was sent; no new deployment was created by this turn.
After authorized completion, verify canonical /api/auth/options becomes passwordReset:true and /api/ready remains200, without sending reset on the user's behalf. Other product requirements remain in MASTER-ACCEPTANCE.md.
All started commands are complete; no automation or background work was scheduled.

## Latest continuation — explicit request to finish by any available method

Read-only checks completed: device online; existing Vercel project and deployment unchanged. Canonical /api/auth/options returned200 with passwordReset:false. Normal CLI metadata inspection confirmed MAIL_FROM present and RESEND_API_KEY absent from Production; no secret value was read or printed.
The current Vercel connector exposes24 operations but no environment-variable write action. The prior secret-installation safety denial remains a boundary; no alternate browser/API/file path, new key, additional reset request or external-account change was attempted.
No code or deployment changes in this continuation. One human action remains before automated release can continue: save the previously issued sending-only key as the Production Secret RESEND_API_KEY in the existing tasks-app project. Do not generate a replacement unnecessarily or repeat the key in notes. A new deployment is required afterward; existing deployments do not pick up added environment values.
All read commands completed. No active/background job was created. This is a truthful blocked handoff, not a completed mail activation or import release.

## 16 September — resume draft release without undoing published auth

Mail capability remains false; the prior RESEND_API_KEY-installation denial is not bypassed, no new keys or real emails created.
Completed focused receipt correction in the original preserved tasks-app feature: opaque copy IDs replace full sent bodies in new receipts; immutable record IDs no longer add causal-clock actors per submission. Legacy raw-content receipts stay readable.10receipt/version unit tests and30Chromium/WebKit retention/performance cases passed; full original-tree source gate176unit passed. Attempted additional browser-budget test write was denied and is not present.
Now sole release writer is this existing account-release worktree, branch feat/draft-recovery-release-20260916, based on current main a336971. A scoped three-way draft-only patch was applied; two conflicts reconciled by retaining current shared auth CSS and invitation fragment URL while adding retained form intent. No mail/auth backend, Vercel config, production database, password or sender key changed. Original feature/index remains preserved at ~/xp/tasks-app.
Current single verification PID93644: source/type checks then allChromium/WebKit, stopping after two failures. Ports9582/5882; outputs draft-current-main. Logs /tmp/tasks-draft-current-main-source.log and /tmp/tasks-draft-current-main-browser.log. Do not edit code/start another suite while this process runs.
Next: inspect actual merged-source result, add release evidence and obtain one ordinary focused review, then normal commit/merge/deploy if approved. No new deployment is claimed yet.

## Latest access check — 16 September, user's 19:53 screenshot

One bounded read-only check completed. Live auth/options returned200/passwordReset:false; ready returned200/ready. Normal Vercel production metadata confirmed RESEND_API_KEY absent and MAIL_FROM present. No secret values read, no new key created, no secret-installation route retried, no reset/email submitted.
The missing production key remains the immediate access blocker. Do not spend another cycle re-running unrelated green tests or claim a redeployment without it enables email. User/operator must save the existing sending-only key through Vercel's authorized interface; then a new deployment and capability verification are required. No time estimate is substantiated while that action remains blocked.
The last two new draft regressions are still red; their rejected storage implementation is not present. Existing main stays a336971; no new code, commit or deployment in this access-check turn. All commands started in this turn have ended.

## Current turn — operator installed Resend key and redeployed

Read-only live options now return passwordReset:true; readiness returns ready. Vercel confirms new deployment dpl_E36wtZ3rC4N5d6fzFF9uZjCVMVQi from unchanged maina336971, with canonical tasks-ultrabricks.vercel.app attached. No reset request or real email sent; actual delivery is not claimed.
The two draft blockers now have implemented source corrections: opaque revision acknowledgements ignore adoption-only clock growth; successful document/new issue/new project requests acknowledge their captured copy even after unmount, never a newer copy. Explicit restore mints a fresh revision. Legacy receipt causal checks remain.
Eight focused browser checks passed in both engines, including the two former red cases and late issue/project creation. Two added real-journal model tests cover newer tab-mirror preservation and restoring after acknowledgement. Source/types/build and180unit pass (/tmp/tasks-exact-copy-source.log, /tmp/tasks-exact-copy-acceptance.log). A synthetic test's title was engine-qualified because the shared fixture correctly avoided a second no-op PATCH.
Current staged tree4112661362c8f172f062036dcb8e4effec5934ad, basea336971. Review PID57741/task TASKS-DRAFT-RECOVERY uses the ordinary read-only3-role pool; report /tmp/tasks-draft-exact-final-review.txt. Single sequential final UI gate PID58384 uses ports9613/5913 then9614/5914; logs /tmp/tasks-draft-exact-{browser,storybook,visual}.log. Do not edit or overlap suites until they end.
After final results: normal review/commit/merge and clean deployment while preserving the newly enabled mail configuration. No rollback to the original old worktree and no secret rewrite is needed.
