# state-lib pilot — tasks-app

Branch: `pilot/state-lib-HYP-1464`. Baseline: Forgejo main `a336971abacb09e387bff83cab53f8f9c926e629`.
This isolated branch preserves the production service and the original unfinished draft/import worktree.

## Implemented slice

The real preference feature now runs on `@ultrabricks/state-lib` by default: list/board view, theme and mobile navigation state. Its existing consumers are unchanged. TanStack Query still owns server data, routing/filter state stays in the URL, and authentication/database/API/unsent draft code is not replaced.

The pre-pilot Zustand implementation is preserved verbatim as `src/features/preferences/baseline.ts`. Run the same app with `VITE_STATE_BACKEND=baseline bun run dev` for the baseline or `VITE_STATE_BACKEND=state-lib bun run dev` for the pilot. The DOM attribute `data-preference-backend` identifies the active path for tests.

The existing `tickets-ui` storage key, `{state:{view,theme},version:0}` envelope and nonpersistent sidebar are retained. Storage failures do not discard the current in-memory preference; the controller exposes `getStorageError()`. This does not replace durable draft storage.

## Reproducible package

`packages/state-lib` is the same private pilot build used in boards-app, not a hand-edited duplicate implementation. `PROVENANCE.json` records source hashes, compiler output hashes and the uncommitted library candidate boundary. The version is `0.1.0-pilot.1`, not a stable API release. No package was published to npm.

## Acceptance

`bun test tests/unit/state-lib-preferences.test.ts` compares1,500 mixed updates against the existing Zustand contract, verifies hydration/reload/storage shape and corrupt/denied storage. Full app browser cases and measured overhead are recorded separately in the comparison report. Do not claim a whole-app migration or performance improvement from this preference slice.

The owner's request authorizes this branch-specific evaluation instead of the default AGENTS preference-store choice. Production stays unchanged until a separately reviewed promotion.

## Executed comparison

The real HTTP/browser baseline and pilot each passed the same4 scenarios across Chromium and WebKit: issue creation/Markdown/status/filtering, preference changes, reload, light theme and mobile navigation. The4 matched board/mobile screenshot pairs were pixel-identical. This is equality to the current app for these scenes, not a new claim of fidelity to Linear.
The preference controller passed1,500 mixed operations against Zustand, storage compatibility and a future-version rejection regression. The full source/lint/types/unit/build check passed before that final narrow version guard; the guard's4-unit-test suite is green and final verification is recorded separately.
The prepared `scripts/compare-state-lib.mjs` is a controller microbenchmark, not an app-speed claim. Its attempted execution was blocked before running; no timings or speedup are reported. No-op suppression in the pilot is an adapter policy that could also be applied to Zustand, not proof that the engine is universally faster.

Promotion is deliberately not automatic: add the next issue-domain slice only after its normalized identity/transaction contracts are integrated and reviewed. Keep current server cache, authentication and durable draft safety intact.

## Selected-backend isolation correction — 17 September

The entry point now dynamically imports only the selected implementation. The preserved `baseline.ts` remains byte-for-byte unchanged; `state-lib.ts` owns its Runtime and hot-reload cleanup. Importing the preference feature no longer initializes an unused second store.

A real browser regression initially observed two `tickets-ui` hydration reads. It now observes exactly one for both baseline and state-lib. The same Chromium/WebKit CRUD, preferences, reload and mobile navigation scenarios pass for both backends. The full source/type/unit/build check passes. This is initialization isolation evidence, not a general latency or bundle-size superiority claim.
