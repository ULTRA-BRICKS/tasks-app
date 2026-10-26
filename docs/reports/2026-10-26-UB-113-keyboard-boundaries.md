# UB-113: keyboard input at React commit boundaries

## Defects and correction

The two real WorkspaceKeyboard implementations subscribed and reset their chord in passive effects. A newly committed page could receive `j` before its listener existed, or accept `g` before a later reset erased that same chord. Both failures were reproduced without timing sleeps by mounting the real components and dispatching at the layout/commit boundary. The state binding additionally read a prior route because its stable getter refreshed only in a passive effect.

Register/revoke the listeners and route-owned chord at commit. Refresh the stable latest-value getter at commit as well. No timeout increase, repeated-key replay, global event queue or native/state behavior exception is introduced. A chord accepted on the old page must still be revoked; a new-page chord must survive; ordinary text input remains ordinary text.

## Actual evidence

- New-page chord RED: both implementations fail, two positive control cases pass. Initial-list input RED: both fail. Previous-route getter RED: native passes, state fails.
- Final component suite:40/40 across Chromium/WebKit, both backends, with and without StrictMode. Wall-clock time is fixed for within-deadline controls; a separate advanced-clock case proves real expiry. The fixture uses real React/router/query/keyboard components; it seeds only a synthetic in-memory query identity, not a production session.
- The unchanged production application matrix passed128/128 after the two keyboard-component corrections, before the final latest-getter correction. It is retained separately; final-source acceptance is recorded in the session ledger rather than inferred from this earlier run.
- The final Tasks check passes336tests with lint, FSD, strict type checking and build. The pinned React SSR control keeps values request-local and produces no layout-effect warnings. A mutant with only route-reset disabled restores four expected failures; product bytes were restored exactly afterwards. Final production logs remain required before shipping.

Reproduce: `bun --bun playwright test tests/e2e/keyboard-lifecycle.spec.ts`; ordinary `bun run check`; original inline/Knowledge/persistence/import-history production suites. `tests/browser/keyboard-lifecycle.html` is a development test entry, not part of the production bundle.

Evidence ledger: `/home/ultra/work/UB-113-finish-20261026/tasks/`. Failed runs are retained. This patch is not full UB-113 acceptance: the state/native whole-bundle size gate remains open, and the larger draft migration is not included in this keyboard commit. No deployment, registry publication or main merge is implied.

## Review scope and responses

The focused correctness/performance/consistency review found no new handler-code bug. Its expiry-window and replay coverage gaps were addressed by fixed-clock controls and StrictMode. App source has no Activity usage; this patch does not claim general hidden-tree lifecycle support. The other global key handlers are bubble listeners or a document capture preview handler; editor/overlay guards remain unchanged. Existing real editor command-menu tests are retained. React18 warning assumptions do not apply to this app's pinned React19 dependency, and the SSR behavior is now executed rather than inferred.
