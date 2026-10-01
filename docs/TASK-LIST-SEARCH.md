# Task list search box (UB-109, UB-94)

The `Search tasks` box on `/tasks`, `/my-tasks`, `/epics` and `/archive` filters the list by the `?q=` URL parameter. Typing quickly used to lose characters. This document is the contract for the fix; `tests/e2e/task-search-typing.spec.ts` and `tests/unit/synced-text.test.ts` enforce it.

UB-94 (earlier report of the same defect, with the one-way-sync proposal) and UB-109 (this fix, with the zero-delay repro) are fixed together.

## Defect and root cause

- Before: `<Input value={params.get('q') ?? ''} onChange={(e) => setFilter('q', e.target.value)} />` made the router location the only source of the box's text.
- `BrowserRouter` (react-router-dom 7.18, `useTransitions` unset) applies every location change inside `React.startTransition`. `history.replaceState` runs synchronously, so the URL already holds `q=g`, but `useSearchParams()` keeps returning the previous `q` until the low-priority transition commits.
- A controlled input is restored to its `value` prop after each event handler. A keystroke that lands before the transition commits is rendered back to the old text, and the next key is appended to that old text. Characters typed between two commits vanish from the input and from the URL.
- Observed by KeyboardC (e2e: after typing `g` the input read empty while the URL already had `q=g`) and reproduced by `pressSequentially('fast typing test', { delay: 0 })`.
- A second, independent defect on the same path: `setFilter` treated the value `all` as "no filter" for every key, so typing the word `all` deleted `q` and cleared the box.

## Decision

The box owns its text; the URL is written one way and read only when something other than the box changed it.

1. **Local text is the source of truth.** The input is controlled by component state that updates synchronously in `onChange`, so no router or query latency can overwrite a keystroke. Only the box re-renders per keystroke; the task list does not.
2. **One-way, debounced, replace-state sync.** `q` is written with `replace: true` after 250 ms without typing, and immediately on Enter or blur. Debouncing is justified by cost, not as a workaround for the race: each committed `q` changes the TanStack Query key and starts one `/v1/issues` request, and WebKit throws `SecurityError` after 100 `history.replaceState` calls per 30 s (iOS Safari; see nusmodifications/nusmods#763, mdn/content#35504), which a per-keystroke write would reach by typing ~100 characters.
3. **IME composition is respected.** No commit is scheduled while an input event has `isComposing`; `compositionend` schedules one for the committed text.
4. **The URL is adopted only when it was not produced by the box.** A commit is remembered until its location comes back. An external change (browser back/forward, a saved view, another route sharing the page component, a link carrying `?q=`) replaces the text and cancels any pending commit; the echo of the box's own commit, in any order, never does.
5. **`q` is a plain text filter.** `all` is a legitimate query; only the Picker filters use it as a "no filter" sentinel.
6. URL stays the owner of filter state (AGENTS.md): reload, deep links and history restore the box; TanStack Query still receives `q` only from the URL.

## Rejected alternatives

- `<BrowserRouter useTransitions={false}>`: removes the lag for this input but disables transitions for every navigation in the app, still re-renders the whole task list and issues a request per keystroke, and still writes the URL per keystroke (Safari limit above).
- Debounce alone with the input still reading `params.get('q')`: the box would show stale text for the whole delay.
- Uncontrolled `<input defaultValue>` plus `key` remount on URL change: remounting on the box's own echo loses focus and caret mid-typing.
- Skip the URL while the input is focused: browser back/forward while focused would leave the box and the list disagreeing.
- Throttle instead of debounce: writes intermediate prefixes the user is still typing past, and issues requests for them.

## Acceptance criteria and tests

| Criterion                                                                                                       | Test                                                 |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `fast typing test` typed with delay 0 leaves the input and `q` equal to the full text (Chromium, WebKit)        | e2e `typing with no delay keeps every character…`    |
| 30 characters at 10 ms arrive intact and add no history entries                                                 | e2e `30 characters at 10 ms intervals…`              |
| A burst of input events inside one task loses nothing                                                           | e2e `a burst of input events inside one task…`       |
| The list still filters by `q`, reload restores it, clearing removes `q`                                         | e2e `typing filters the list, replaces history…`     |
| Back/forward and in-app navigation adopt the URL's `q`, never stale typed text                                  | e2e `navigating away and back adopts the URL query…` |
| Leaving the box immediately still commits                                                                       | e2e `typing then leaving the box straight away…`     |
| `all` is searchable                                                                                             | e2e `the word all is a query, not "no filter"`       |
| IME composition is not truncated; the URL waits for committed text (Chromium; Playwright has no WebKit IME API) | e2e `IME composition is not truncated…`              |
| Own commits and their echoes (including out of order) are not adopted; foreign changes are                      | unit `tests/unit/synced-text.test.ts`                |

## Out of scope

- Other URL-bound controls (Pickers, due-date filter): discrete clicks cannot race a transition.
- The command menu search (`⌘K`), which is local state already.
- Server-side search behavior and ranking.
- Visual design: the box is unchanged, so no new visual baselines.
