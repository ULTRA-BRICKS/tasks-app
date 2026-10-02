# Draft recovery release candidate — 16 September 2026

Base: published tasks-app main `a336971`. This candidate adds only draft retention and recovery; published account/reset/mail code and the corrected login layout are not reverted. It does not install secrets, reset passwords or import Linear records.

## Retained input

Issue/project/cycle documents, comments, relation targets, unacknowledged property changes, unapplied dates, saved-view names and non-secret settings use account/workspace-scoped recovery copies. `/drafts` exposes retained copies and JSON export. Session copies are mirrored to local browser storage; failure to keep a durable copy produces a visible warning, not a false “saved” claim. Login passwords and reset/invitation proofs are excluded.

Late responses clear only the submitted input revision. Different tabs keep independent copies; recovery acknowledgements use causal versions rather than wall-clock ordering. Explicit restoration retains a separate backup of different current text. Existing comment-retry idempotency stays on the server.

## Receipt growth correction

New receipts identify an opaque exact-copy revision instead of duplicating the submitted body. Their immutable journal keys no longer become a new actor in every causal clock: the existing page actor advances. Unchanged adopted mirrors retain their copy identity. Previous-format records and receipts remain readable.

Receipt records still grow linearly with submissions. This is not automatic infinite retention or encrypted cloud backup. The older per-submission body copies and clock growth are removed for new versioned records; compatibility with a genuinely old record can retain its legacy payload once. Browser clearing/eviction, device loss and unsent binary attachments remain separate limitations.

## Executed verification so far

The original preserved feature passed 176 source/unit checks and 30 focused Chromium/WebKit retention/performance scenarios after this correction. The draft-only merge onto current main then passed source/types/build with 176 unit tests and a full 142-case Chromium/WebKit run. Ten of the unit cases exercise receipt identity and causal ordering; the attempted additional browser storage-budget test was not written and is not counted.

External review and final visual/Storybook gates are recorded in WORK-CHECKPOINT.md. This candidate is not a claim of completed production deployment, working Resend configuration, full Linear import, or 90% reference parity.

## Review responses and storage/privacy tradeoffs

The first security review identified that durable copies outlive logout. This is now an explicit decision: sign-out with any retained copies warns that they are unencrypted, offers cancellation and directs shared-device users to export/remove their copies first. Recovery has a separately confirmed Remove local copies action, scoped to the current account/workspace. Canceling either action changes nothing. Storage-failure warnings are included before sign-out; local cleanup failure cannot prevent server logout. No automatic deletion of unsent work was introduced.

An isolated in-memory Storage model now executes the actual journal write path through 60 large submissions: all 60 receipts contain only revision identities, clocks have one actor, and total encoded data stays under 200,000 characters. A second actual-journal model proves removing Alice's copies leaves Bob's copy intact. These are deterministic algorithm/storage-model tests, not measurements of a device's disk.

The browser diagnostic measured synchronous 100,000-character edits at p95 0.5 ms Chromium / 1 ms WebKit on this Mac, and warmed missing-key reads performed no storage enumeration. This does not certify slow-phone timing. Immediate durability remains deliberate: debouncing the only durable mirror would reopen the close-tab loss window the user explicitly asked to remove. Serialization now occurs once per write, and an ordinary remote update no longer re-indexes every in-memory draft; only explicit clearing/removal needs that reconciliation.

The first correctness reviewer timed out without a final verdict. It is not an approval. The next focused review must cover the final source, including the privacy decision above. Retained receipt count and cold recovery indexing remain linear and may eventually reach browser quota, at which point the UI warns and allows export; infinite storage or guaranteed survival of site-data deletion is not claimed.

## Final follow-up result: two reproduced blockers, not a release approval

The second ordinary review completed all three roles. Security and performance reported no release-blocking issues after the explicit local-copy consent/removal and compact receipt changes. Correctness identified two missing cases, subsequently reproduced with real browser assertions:

1. An unchanged copy adopted in another tab and reloaded from the recovery page gains a new causal actor despite retaining the same exact-copy ID. The original tab's successful submission fails to suppress that copy. A fresh tab restores already-submitted text.
2. An issue save completes after its editor is closed. The unmounted editor skips acknowledgement of the durable submitted draft. That old draft still appears on the recovery page and may require an avoidable version-conflict resolution on reopening.

The regressions are appended to `tests/e2e/draft-retention.spec.ts`. Their logs are `/tmp/tasks-draft-adopted-red.log` and `/tmp/tasks-draft-followup-red.log`; both failed at their intended text assertions, not setup. The earlier146-case passing browser run does not cover these added cases.

The intended next change is exact-revision acknowledgement independent of adoption clocks for new opaque IDs, plus acknowledgement of a captured submitted copy even after unmount, without deleting newer text. Explicit restoration must create a new revision. That implementation request twice received the tool's indeterminate safety-status rejection before execution. Its read-back confirmed no source modification; capture/acknowledge APIs were NOT installed.

Release remains blocked. No commit, merge, deployment or mail activation was performed. Existing published auth remains at a336971. Do not describe this candidate as universally lossless or already available on the live site.

## Confirmed correction after the operator enabled Resend

The operator installed the sending key and redeployed the existing release. Read-only canonical checks now return passwordReset:true and ready. No password-reset request or email was sent by this work.
The previously rejected source change is now implemented through ordinary repository edits and has executed coverage. Versioned receipts identify an exact copy independent of clocks introduced by unchanged adoption; legacy receipts retain causal checks. Snapshot/acknowledgement APIs allow a completed request to acknowledge its submitted version after unmount without removing newer local text. Explicit manual restore creates a new revision, and unchanged migration preserves the source navigation path.
New regressions cover unchanged adoption via a reload of /drafts, late closed-editor save, and issue/project creation that completes after navigation. All eight Chromium/WebKit instances pass. Unit coverage also proves a late receipt preserves the newer tab mirror and explicitly restored text remains a new unsent revision. Source/types/build and180 unit tests passed; logs /tmp/tasks-exact-copy-source.log and /tmp/tasks-exact-copy-acceptance.log.
The first new closed-editor test reused a title across browsers and awaited a write that WebKit correctly skipped. Its synthetic title is now engine-qualified; save assertions were retained. This is test isolation, not a product workaround.
Final full regression/review/publication is a separate gate; the candidate is not described as shipped until its merge and canonical deployment are verified.
