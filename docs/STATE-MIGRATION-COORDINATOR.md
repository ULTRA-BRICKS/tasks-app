# Tasks comparison-branch checkpoint

Baseline revision: `a4ae80b1aae42293674f091c14ab9b59b37609e0`. Branch: `feat/state-complete-HYP-1491`. The older dirty migration/import worktree is untouched.

The coordinator moved 61 mutable UI owners across 14 shipped source files to the optional `useLocalState` binding. Their original declarations and specification links are in `state-ui-owner-migration.json`; an AST inventory test verifies that these mutable values no longer use direct React-local ownership. Lifecycle-only initializers, stories and explicit baseline/reference modules are excluded, not disguised as migrated mutable values.

The binding registers mounted values in one application Runtime, exposes a cached external snapshot, removes registration on unmount and ignores stale setters. It retains the useState call contract; the baseline build selects original React ownership. `UiStateProvider` is mounted at the app root. Six effect dependency lists explicitly include the custom stable setters; no lint suppression was introduced.

Fresh local verification: 245 unit tests pass; `bun run check` passes generation, FSD/lint, type-aware checks, tests and build. The existing `verify-state-lib-ab.ts` browser harness passes six Chromium/WebKit scenarios per backend against separate synthetic servers. That harness specifically covers preferences/document adapters and does not establish exhaustive parity of all newly moved UI state. The pinned original baseline is separately built in `tasks-baseline-comparison-20260924` with VITE_STATE_BACKEND=baseline.

## Still required

This is not yet a complete migration acceptance or a remote staging release. Query/mutation orchestration remains a declared external data source. The inherited optional selector helper captures its initial selector/source; changed-selector lifecycle needs a regression and correction. Broader UI/IME/resource coverage, cross-layer ownership, complete source-mechanism mapping and entry/memory/interaction comparisons remain open. The proposed new browser checker was denied and was not recreated through another transport.

No app source has been committed/pushed from this new worktree yet. No production credentials, main merge or remote database changes occurred. Remote baseline/state staging requires an isolated authorized database and auth configuration; Neon currently requires renewed authorization. Local SQLite fixtures are not a reason to disable the production deployment safety guard.

Do not rerun `scripts/migrate-ui-owner-imports.ts` blindly: it is a one-time migration that wrote the original-location manifest. Continue from the resulting source and tests, not from a fresh bulk replacement.

## Independent review before branch publication

The final review (`/tmp/tasks-full-state-source-review.log`) confirms the 61-owner source inventory but does not establish exhaustive UI parity. It flags cases requiring direct tests: StrictMode teardown/re-attach writes, preservation of owner entries when React discards memo caches, new-issue draft keys across identity changes, stale idempotency attempts after a rejected request completes offscreen, and validation of restored attempt payloads. The selector-capture issue remains latent in the helper and must not be reported fixed. These concerns were not silently accepted as proven bugs or waived; reproduce them before deciding the correction.

The performance reviewer hypothesized that Runtime retains all created signals. Source inspection must decide that rather than importing the assumption: the current Runtime owns subscriptions/effects, not a registry of every bare signal. Per-hook lifecycle overhead and repeated keyboard layout reads are nevertheless measurable follow-ups. Do not revert application ownership to React-local state merely to hide that cost.

The older child handoff and broad manifest predate the coordinator's 61-owner pass; read this checkpoint together with `state-ui-owner-migration.json`. Their not-migrated query/data-layer coverage remains open, while the newer UI-owner source changes are recorded separately. Current changes are staged but not committed or remotely deployed. No full migration acceptance is claimed.
