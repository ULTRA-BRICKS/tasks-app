# HYP-1491 state migration handoff (PARTIAL, VERIFIED for the new work)

Branch base: `a4ae80b` (HYP-1499 lifecycle fix). No commits, pushes, deploys or external calls were made.

## Verification executed (2026-09-24)

A follow-up session ran the full verification plan end to end from a clean worktree. Every command
passed on the first attempt; **no source or test edits were required** anywhere in the new work
(`src/shared/lib/state/*`, `src/features/keyboard/*`, `src/pages/issue-new/*`). Exact commands and
results:

```
bun install --frozen-lockfile
  -> 1 package installed (@ultrabricks/state-lib workspace link), no changes to lockfile

bun test tests/unit/state-core.test.ts tests/unit/state-react.test.tsx tests/unit/state-keyboard.test.ts tests/unit/state-issue-draft.test.ts
  -> 26 pass, 0 fail, 70 expect() calls, 4 files

bun test tests/unit/state-lib-document.test.ts tests/unit/state-lib-document-lifecycle.test.ts tests/unit/state-lib-preferences.test.ts tests/unit/state-lib-persistence.test.ts
  -> 32 pass, 0 fail, 3170 expect() calls, 4 files (pre-existing HYP-1497/1498/1499 work, unmodified;
     includes the "disposal attempted during notification does not poison subsequent controller
     cleanup" regression test from HYP-1499, still passing)

bun test tests/unit
  -> 241 pass, 0 fail, 4431 expect() calls, 37 files (full unit suite, including the above)

bun run typecheck   # oxlint --type-aware --type-check --deny-warnings
  -> clean, zero errors/warnings

bun run lint        # oxlint --deny-warnings && bun scripts/check-fsd.mjs
  -> clean; "FSD import boundaries pass (92 source files)" — shared/lib/state imports from
     pages/features are accepted by the FSD boundary check

VITE_STATE_BACKEND=baseline  bun --bun vite build --outDir dist-baseline  --emptyOutDir
  -> succeeded, 2324 modules transformed, built in 493ms

VITE_STATE_BACKEND=state-lib bun --bun vite build --outDir dist-state-lib --emptyOutDir
  -> succeeded, 2321 modules transformed, built in 393ms
  (both dist-baseline/ and dist-state-lib/ were deleted immediately after inspection; they are not
  committed and must not be left in the tree — oxlint is NOT scoped away from them, so leaving them
  behind makes `bun run lint` fail on the *minified build output* as if it were source; this is a
  build-hygiene trap, not a source defect — always rm -rf them before running lint/check again)

bun run check        # prepare:generated && lint && typecheck && test && build (default state-lib backend)
  -> green end-to-end after the dist-baseline/dist-state-lib cleanup above
```

The one prior claim this disproves: the "known risk" about top-level `await import()` in the
`index.ts` selectors and FSD lint acceptance (see bottom of this file) is resolved — both backends
build cleanly and `lint:fsd` passes with the new imports in place.

"Test-first" was already satisfied for this new work in the sense that matters here: the tests were
written before this session executed them, and every one passed against the implementation as
written, with zero source changes needed to make them pass.

## State found on arrival (already in the worktree, untracked or renamed, not written by me)

- Renames: `keyboard/index.tsx -> baseline.tsx`, `issue-new/ui.tsx -> baseline.tsx`; `issue-new/index.ts` switched to a backend selector.
- Core: `src/shared/lib/state/{scope,react,storage,backend}.ts` (Scope over `Runtime`, `useStore/useSelector/useScope/useLatest`, SSR server snapshot, StrictMode-safe deactivate/activate with generation tokens, opaque `resource()` slots).
- Keyboard: `controller.ts`, `state-lib.tsx`, `reference.tsx`, `index.ts` selector.
- Issue draft: `draft-controller.ts`, `state-lib.tsx`.
- Tests: `tests/unit/state-{core,issue-draft,keyboard,react}`, fixtures `tests/fixtures/state-migration/index.ts` (deterministic synthetic issues, memory storage, deferred, no-op mail/Slack/blob/GitHub recorder, fake cache port).
- Static read-through only: every import in these files resolves to an existing export (`ApiError`, `errorMessage`, `navigationChords`, `shortcutGuard`, `toExternalStore`, `selectExternalStore`, `issueDraftKey`, `newIssueDraft`, `createIssueInput`, `Draft`). No incomplete import was found; I therefore made **no source edits**.

## Edits made

- `docs/state-migration-manifest.json` (new, prior session): per-location owner, baseline mechanism, new owner, anchors, baseline revision, parity tests, status.
- `docs/STATE-MIGRATION-HANDOFF.md` (this file, prior session; verification results added in this session).
- No source or test files were edited in the verification pass: every test, typecheck, lint, and build command listed above passed against the implementation exactly as found.

Anchors (`/spec#s4-4` etc.) are copied from the request; the spec is not in this repo, so their targets are **unverified**.

## Ownership coverage (from grep, 146 `useState/useReducer/useQuery/useMutation` hits in 33 files)

| Area                                                                                                                                                                             | Status                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences, issue document editor                                                                                                                                               | migrated earlier (HYP-1497/1499)                                                                                                                                                    |
| Keyboard, new-issue draft, core + React bindings                                                                                                                                 | migrated, verified (26/26 new tests pass; typecheck/lint/both backend builds/`bun run check` all green)                                                                             |
| Planning document, knowledge document, issues list, issue details, settings, auth, command menu, workspace policy, issue properties, board, navigation, app shell, press preview | **not migrated**                                                                                                                                                                    |
| Server cache (TanStack `useQuery`/`useInfiniteQuery`/`useMutation`)                                                                                                              | retained as explicit infrastructure adapter; only `issue-new` has a port (`onCreated`) and the document controller ports; no query-transport abstraction exists for the other hooks |

**Whole-app migration is NOT complete.** Roughly two thirds of the stateful files are untouched. Form-local fields (auth, settings inputs) may reasonably stay component-local; that classification still needs a decision.

## Genuinely missing

- Migration of the planning-document and knowledge-document drafts (same shape as the issue document controller; best next reuse target).
- Issues-list selection/collapse/bulk mutation optimistic-error tests, issue-details forms, navigation tests beyond keyboard chords.
- Explicit retained-query transport port and interchangeable adapter contract.
- Staging build manifests (baseline/state) and CI wiring: only the env switch exists; both backends build successfully (see above) but there is no CI job running both.
- Spec anchor verification.
- `bun run test:state-lib:ab` (`scripts/verify-state-lib-ab.ts`) was not run in this pass — it is an existing A/B script outside the explicit verification list for this task; still unexercised.

## Staging env and A/B builds (verified)

Only env name: `VITE_STATE_BACKEND` = `baseline` | `state-lib` (default `state-lib`). No credentials required; fixtures and no-op effects are in `tests/fixtures/state-migration`.

```
VITE_STATE_BACKEND=baseline  bun --bun vite build --outDir dist-baseline  --emptyOutDir   # verified: succeeds, 2324 modules
VITE_STATE_BACKEND=state-lib bun --bun vite build --outDir dist-state-lib --emptyOutDir   # verified: succeeds, 2321 modules
bun run test:state-lib:ab    # existing scripts/verify-state-lib-ab.ts — NOT run this pass, see "Genuinely missing"
```

Both `dist-baseline/` and `dist-state-lib/` must be deleted (`rm -rf dist-baseline dist-state-lib`) after
inspecting a build — they are gitignore-exempt (`.gitignore` only covers `dist/`) and `oxlint`/`bun run lint`
will otherwise try to lint the minified build output itself and fail with hundreds of spurious
`no-unused-expressions`/`no-cond-assign` errors. This is a build-hygiene footgun, not a source defect;
confirmed by reproducing it once in this session and clearing it by deleting the two directories before
re-running `bun run check`.

The former "known risk" here — whether `index.ts`'s top-level `await import()` selectors work under the
Vite target and whether FSD lint accepts `shared/lib/state` imports from pages/features — is resolved:
both backend builds succeed and `bun run lint:fsd` reports "FSD import boundaries pass (92 source files)".
