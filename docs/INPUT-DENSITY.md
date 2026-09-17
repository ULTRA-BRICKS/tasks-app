# Input-aware issue list — 17 September 2026

The supplied screenshot shows narrow desktop Safari using60px phone rows with invisible separators. Available width is not a reliable proxy for touch input.

Default rows now use42px with a fine primary pointer and56px with a coarse pointer at every width, including tablets. Compact is36px on desktop,48px on touch; Comfortable is56px. All modes retain a1px divider. Touch titles use14px, selection/preview targets44px. The checkbox remains visually small inside a larger label target; holding the selection label does not open the row preview. No user-agent sniffing and no size change during pointerdown are introduced.

The existing Issue actions menu offers Auto / Compact / Comfortable and saves the selection in the existing browser preferences. Media-query changes follow input-capability changes; width still decides how many metadata columns fit. Narrow fine-pointer headers and group headings use desktop-like spacing rather than oversized mobile spacing. App navigation still collapses when width requires it.

This changes only list geometry/selection, not server schema, import state, authentication, permissions or saved issue content. Parent is3da8c2a. Context-menu, keyboard and activity-history work is owned by the separate tasks-keyboard worktree; none is silently discarded or included half-finished.

Separate user-authorized data update completed: workspace display name glide.vc, same ID and internal slug; empty Ultrabricks team UB with7statuses.1717issues and2memberships unchanged. This was not another import or data reassignment.

Evidence: old-code density regression failed3of4cases; final12Chromium/WebKit cases cover narrow/wide fine pointer, phone/tablet coarse pointer, visible separators, nonoverflow, persistent mode selection, resize and44px selection without unintended navigation. Generated tokens, source,176unit tests and independent TypeScript checks passed. Full release gate/review results are recorded in WORK-CHECKPOINT.md when completed.

References are NOT stored in Git: personal Library /ultra/Tasks UI references/{mobile,desktop,feedback}. Desktop archive contains27PNGs; mobile PDF contains50pages. User originals are the target; a test regression baseline is not a90%Linear parity measurement. The attempted new matched-capture script was denied before writing; no new native-pixel overlay is claimed from it.

Primary implementation reference: W3C Media Queries Level4, Interaction Media Features — https://www.w3.org/TR/mediaqueries-4/#mf-interaction . Primary-pointer detection is a capability signal, not a device-name classifier. Manual density remains available for hybrids and individual preferences.

## Release follow-up — September 18

The old canonical bundle was still index-Ck3b2LUO.js/index-pVbhQoLh.css when the user reported no change. This was an unpublished-release problem, not evidence that the user needed to clear browser storage.
The completed review found one actual geometry error: a24px selection target exceeded14/16px desktop grid tracks. All existing first-column tracks now use the same selection-size variable; real-browser assertions verify that selection does not overlap priority.
The old44px test simulated only a narrow desktop. It now uses an explicit coarse-pointer touch context and keeps its44px assertions. Density tests reuse their own normal synthetic login cookies. Production login limits are unchanged.
A combined two-engine run exhausted the shared fixture's12-login/15-minute budget near the end of WebKit (127passed before two authentication setup failures). Final whole-project coverage is run with a fresh isolated server per browser engine, without test omission, retry suppression or auth-rule changes. This is test isolation, not a claim that the failed combined run passed.
Unchanged app content, import records, account credentials and live database are outside this patch. Final tested hashes and publication receipt are recorded with the PR and checkpoint.

The final functional run passed176unit tests,68Chromium cases and68WebKit cases, plus18Storybook checks. A previously intermittent G→P regression failed twice during verification: the chord prefix was lost whenever the keyboard effect reinitialized on callback rerenders. The prefix now lives in a ref, while navigation clears it. Six focused repeated cases and both full project runs passed after this fix.

Runtime visual acceptance covers separate narrow fine-pointer and touch-phone states. The two affected list baselines were deliberately replaced only after image inspection (restored dividers, input-appropriate height, matching selection/grid width). A new coarse-pointer phone image is added; board/detail/new-object baseline images were not changed. These are application regression references, not the user's original Linear files and not a90%parity score.

Production verification captures the actual public HTML/JS/CSS in Chromium/WebKit with synthetic API responses only, comparing the same deterministic18-row fixture before and after publication. No real login, reset request, issue write or private source-content export is performed. The final proof checks default height, visible1px lines, text size, no horizontal overflow, and Compact persistence after reload.

Test-harness boundary: a proposed per-browser runner-file write was rejected before execution. It is absent and package scripts were not altered through another route. The complete browser results above are from explicit fresh-server project runs; they do not claim that the old combined one-server test command avoids its synthetic-login quota limit. No production rate limiter was weakened.
