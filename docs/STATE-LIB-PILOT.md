# state-lib pilot — tasks-app

Current comparison branch: `feat/state-lib-HYP-1497`, based on main `1d3ac4d21d64e9ba77d4ccd05fdbe436e567f436`. The earlier `pilot/state-lib-HYP-1464` branch remains preserved. See `STATE-LIB-MIGRATION-REPORT.md` for current evidence, limitations and publication state.

## Implemented surface
UI preferences use `@ultrabricks/state-lib` by default: list/board view, theme, input-aware density and transient mobile navigation. TanStack Query owns server state; filters remain in the URL; authentication, database and inline document-editor code are not replaced.

`VITE_STATE_BACKEND=baseline bun run dev` selects the Zustand implementation retained from the pinned main. `VITE_STATE_BACKEND=state-lib bun run dev` selects the pilot. Only the selected implementation initializes; `data-preference-backend` identifies it in the browser. This dynamic import avoids a dormant second store but adds an asynchronous module/chunk boundary; no startup-speed advantage is claimed.

## Persistence contract
The existing `tickets-ui` key and version-zero envelope are retained: `{state:{view,theme,density},version:0}`. The sidebar is not persisted. No-op state updates and unchanged persisted projections do not write storage.

If hydration encounters an unknown numeric storage version, that store instance never overwrites it. Preferences remain editable in memory; `getStorageError()` returns `UNSUPPORTED_STORAGE_VERSION`. This protection is not a cross-tab coordination protocol. There is no UI error banner yet, and the adapter is not a durable unsent-draft store. Storage failures retain current in-memory preferences.

## Reproduction and evidence
`bun run test:state-lib:ab` runs both backends sequentially against separate synthetic in-memory databases in Chromium/WebKit. Defaults are local ports 6362/6363; `WEB_PORT`/`API_PORT` override them. A production APP_URL from the parent shell is not used. Keep one active browser suite per worktree.

The current full check contains 192 passing unit tests, including 9 preference contracts and a 1,500-operation independent Zustand comparison. The main A/B browser suite passes 6 scenarios per backend. The separate input-density suite passes another 12 per backend. Pixel-identical screenshots prove equality only for the captured scenes, not whole-product equivalence or Linear design fidelity.

## Package boundary
`packages/state-lib` contains the private `0.1.0-pilot.1` compiled runtime. `PROVENANCE.json` pins the source/build hashes and explicitly records an uncommitted source candidate. This is not an npm/stable release, normalized structural store, distributed Undo/FSM implementation or Wasm-equivalence proof.

The pending issue-editor contracts are text-only requirements under `docs/state-lib-pending/`; they are not an implemented controller or passing tests. HYP-1497 tracks app/domain completion; HYP-1498 tracks the remaining shared persistence and UI-diagnostics work. Do not merge this comparison into main or deploy it over production without separate acceptance.
