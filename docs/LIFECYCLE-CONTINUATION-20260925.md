# Tasks migration lifecycle continuation

Date: 2026-09-25. Branch `feat/state-complete-HYP-1491`; unchanged original comparison checkout `tasks-baseline-comparison-20260924`. The pending61-owner migration remains staged. No complete-app or cloud-staging acceptance is claimed.

## Verified corrections

`useSelector` captured its first source, selector and equality function in a lazy useState initializer. A real Chromium StrictMode fixture reproduced Alpha remaining visible after the selector changed to Beta. The selector view now follows all three identities with useMemo. Chromium and WebKit verify selector changes, switching the source, ignoring writes to the old source, observing the new source, functional local updates, unmount/stale-setter isolation and remount.

The UI registry also lost a user's value when a replacement memo entry was created before the old owner detached. The existing mounted Runtime signal is now reused across that handover, not a value copied at render time. Registration stays exclusive, genuinely unmounted owners still restart from their seed, and detached setters remain ignored. The source type is inferred from the exported Runtime API, not a nonexistent root Writable export.

Focused unit verification is10pass/0fail; the actual two-engine browser scenario passes. TypeScript `tsc --noEmit` passes. The full255-test application suite is251pass/4fail, with the four remaining failures listed below. They are active, not skipped.

## Remaining red contracts

1. A malformed saved creation attempt must be discarded while preserving draft text.
2. A permanent API rejection after disposal must release the saved attempt instead of freezing the next visit.
3. A late successful response must not delete a newer draft saved under the same key.
4. A disposed controller must not start another create.

These were reproduced in `tests/unit/state-lifecycle-issue-draft.test.ts`. A proposed change to the creation controller was denied before execution, so `src/pages/issue-new/draft-controller.ts` remains unchanged. No alternate transport or weakened test was used to manufacture acceptance. Identity changes while the new-issue page remains mounted also need direct integration coverage; the selector fix does not claim to solve that separate controller lifetime.

## Spec and repeatable verification

- [Stable framework snapshots and selectors](https://state-lib-lab.vercel.app/spec#s6-1): source/selector identity affects the rendered selection; old subscriptions must not win after a source switch.
- [Registered local UI ownership](https://state-lib-lab.vercel.app/spec#s4-9): memo recreation must not discard typed input; unmounted instances do not retain authority.
- [Scope lifetime](https://state-lib-lab.vercel.app/spec#s4-7) and [persisted state](https://state-lib-lab.vercel.app/spec#s8-5): distinguish a disposed UI controller from a completed durable request and a newer saved draft.

Run the dedicated browser fixture with `VITE_STATE_BACKEND=state-lib bun --bun vite --host 127.0.0.1 --port 6931 --strictPort`, then `node tests/state-lifecycle-browser.mjs`. It contains only synthetic state and no API calls. Run the state-react, state-lifecycle-registry, state-ui-ownership and state-local-hook unit files for the corrected subset. Run the full `bun test tests/unit` to retain visibility of the four creation-controller failures.

The delegated workflow stopped at its600-second parent wait ceiling and returned inconsistent file-status summaries. The coordinator inspected actual files, confirmed no active writer and ran every inherited test before taking over. Do not start another overlapping agent or mistake the earlier child's report for verification. Keep the baseline, staged migration and outstanding red tests intact. Do not publish this branch as migration-complete while these four assertions fail.
