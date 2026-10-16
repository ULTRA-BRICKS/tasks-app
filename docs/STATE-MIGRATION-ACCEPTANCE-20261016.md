# Tasks state-lib integration — acceptance and remaining goals

Date: 2026-10-16. Worktree: `tasks-state-resume-20261014`, branch `fix/state-staging-completion-20261014`, based on published `beaeec8a3c73aab41155ad3096406b27b3a21a84`. This current record supersedes the status summaries in the historical handoff, not their original observations.

## Implemented and verified

The issue-creation controller is constructed only after a real identity exists and is keyed by route, account, workspace and draft defaults. A same-identity refresh preserves the editor; an identity change revokes the old controller. Late results settle only their own saved draft and cannot navigate the replacement page or overwrite newer work.

The recovery store is now an instance with explicit storage/event ports, owned by a state-lib scope. Its listener and caches are released on final disposal; the revision is a scope value. The baseline retains its explicitly separate lazy facade. Native disclosures use a registered open value in the state-lib build; the baseline keeps browser-owned state and an immutable initial default. The default is captured with a setter-less state initializer, not a ref read during render, so the normal React-Compiler lint is satisfied.

The final correction pass reproduced and fixed three additional contract failures: construction on a LAN preview without `crypto.randomUUID`, release stopping at the first throwing disposer, and registration of a resource after disposal. Writer IDs fall back to cryptographic random bytes; they are not credentials. All cleanup attempts run before errors are rethrown, and multiple failures remain observable. A real mounted StrictMode provider test disproved the hypothesis that effect replay destroys the surviving store: deferred disposal is cancelled by reactivation, exactly one listener remains, and final unmount releases it.

## Verification on the current source

| Check                              | Result                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Full unit suite                    | 288 passed, 0 failed, 47 files                                                                                             |
| Complete `bun run check`           | Passed: generation, lint, FSD, ownership audit, type-aware checks, unit tests and build                                    |
| Independent `tsc --noEmit`         | Passed                                                                                                                     |
| Credential-pattern scan            | Passed over 334 text files; not a substitute for a security audit                                                          |
| Same-route identity cases          | 20 passed: ten scenarios in Chromium and WebKit                                                                            |
| Mounted recovery provider          | Both engines: StrictMode replay, real writes, final cleanup, remount recovery, stale-owner isolation                       |
| Native disclosure parity           | Both backends and both engines: mouse, keyboard, focus, parent rerender, initial-open and changed-default behavior         |
| Existing source/selector lifecycle | Chromium and WebKit passed                                                                                                 |
| Full application A/B subset        | 12 passed: six per backend, including real local API creation, draft navigation, persisted creation fields and preferences |

The source audit identifies 62 registered application-state hook sites. It also explicitly lists retained external adapters, immutable mount snapshots, framework resources and baseline-only sites. It is a hook/JSX inventory, not proof that arbitrary mutable refs, class state or external SDK internals have been exhaustively analysed.

## Traceability

| Source and observable result                                                                   | Specification mechanism                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/issue-new/state-lib.tsx`: identity-bound controller and retained same-account draft | [Scopes §4.7](https://state-lib-lab.vercel.app/spec#s4-7), [React bridge §6.1](https://state-lib-lab.vercel.app/spec#s6-1)                            |
| `src/shared/lib/state/scope.ts`: full release, revoked handles, error aggregation              | [Scopes §4.7](https://state-lib-lab.vercel.app/spec#s4-7)                                                                                             |
| `src/shared/lib/draft-persistence-scope.ts`: explicit resource lifetime and revision           | [Persistence §8.5](https://state-lib-lab.vercel.app/spec#s8-5), [Scopes §4.7](https://state-lib-lab.vercel.app/spec#s4-7)                             |
| `src/shared/ui/disclosure.tsx` and the 62 registered UI sites                                  | [Transient UI ownership §4.9](https://state-lib-lab.vercel.app/spec#s4-9)                                                                             |
| Identical API behavior in baseline/state-lib tests                                             | [Compiled/uncompiled contract §5.1](https://state-lib-lab.vercel.app/spec#s5-1)                                                                       |
| Retained TanStack cache/transport                                                              | [Replaceable data sources §8.1](https://state-lib-lab.vercel.app/spec#s8-1), [Built-in source types §8.4](https://state-lib-lab.vercel.app/spec#s8-4) |
| Complete emitted artifact comparison                                                           | [Performance and size budgets §13](https://state-lib-lab.vercel.app/spec#s13)                                                                         |

## Goal evaluation

The measurable win in this continuation is specific lifecycle and UI correctness, not a proven universal speed or code-size win. The Tasks application still directly uses its existing TanStack server-cache hooks; no state-lib query engine or automatic lowering of all callbacks was added. URL/router state and opaque framework resources retain their defined ownership boundaries. An instance-owned persister is not a claim that its causal merge algorithm has been replaced by the complete planned toolkit persistence policy.

The latest deterministic published-source build contained 1,365,768 raw / 432,694 gzip JavaScript bytes in baseline and 1,370,060 raw / 434,528 gzip in state-lib: +4,292 raw and +1,834 gzip. This counts all emitted JavaScript chunks, not first-route transfer; source maps are recorded separately. The exact staged tree and each emitted file hash are in the paired measurement JSON. These figures must not be relabelled as a different source revision after code changes.

Smaller authored code, smaller complete downloads, lower retained memory and no latency regressions in every workload remain unproved for this application. Tests are correctness observations, not bug-rate statistics. No new performance measurements were taken under the concurrent host load, and earlier controller results are not applied to this new source.

## Deployment boundary

The laboratory site is separately deployed and its checkbox interaction is fixed. It is not an independent deployed Tasks application. The requested authenticated baseline/state-lib staging pair still requires isolated runtime database credentials and deployment configuration. Earlier role-provisioning operations were denied; no owner credential, production database or local-test-mode bypass was substituted. Main and production are untouched.

## Reproduction

`bun run check`, `bun run typecheck:tsc`, `bun run check:secrets`; the standalone browser scripts are `tests/state-issue-identity-browser.mjs`, `tests/recovery-provider-browser.mjs`, `tests/disclosure-browser.mjs` and `tests/state-lifecycle-browser.mjs`. The selected app A/B runner is `bun run test:state-lib:ab`; it creates separate synthetic local databases. Build each variant with `VITE_STATE_BACKEND=baseline` or `state-lib` and a distinct output directory outside the source tree. Never infer whole-project acceptance from only a static build or a subset of browser scenarios.

## Publication

Implementation commit `bb74b069379a2325408d6aa336c9e3a8e3736598` is pushed and its remote SHA verified; [PR64](https://git.hyperide.ai/ultrabricks/tasks-app/pulls/64) is stacked on the existing complete-migration branch, not main. A final three-role read-only Codex review of the exact index found no confirmed blocking defect. The earlier Sonnet quota failure was not counted as approval. Both post-publication build artifact sets match the reviewed candidate exactly. The non-blocking callback-dependency cleanup remains noted separately from observable lifecycle defects.
