# Mobile shell and stable live updates — 24 September 2026

Base: d58f445. This release keeps the current authenticated MCP connector, existing overflow menus, source-history presentation and content-import data. No schema migration, user change or integration credential change is part of this patch.

## Implemented behavior

The public application shell has a versioned Service Worker. Build-time precaching installs the HTML, JS, CSS and public registration assets together. A warm navigation returns cached public HTML immediately and checks for a compatible update in the background. New code waits for an explicit Reload to update action; there is no automatic reload while editing. API responses, GraphQL, one-time account-link pages, OAuth metadata, cross-origin requests and mutations are excluded from CacheStorage.

This is **public-shell caching**, not completed persistent caching of authenticated workspace content. Private read-model restoration, revocation-aware persisted identity and offline workspace data remain open and must not be inferred from cached JavaScript.

The visible issue list refreshes every 15 seconds for one loaded page; for multiple pages the interval grows proportionally to keep periodic traffic at an average of four page reads per minute. Manual refresh is immediate. Hidden command-palette results do not poll. New arrivals are staged behind a Review updates badge. Existing row order and group slots remain stable until that action is chosen. Confirmed revisions are revealed one row at a time with a short background highlight and suffix erase/type transition; consecutive bursts coalesce to the latest revision. Selected text and focused input pause background presentation. Reduced-motion users receive final text without animation. Bulk actions use the fresh server models, not the delayed presentation copy.

Items no longer returned by the query keep their slot until review and are counted as left this view, not falsely called deleted. Choosing Review updates adopts the current order and intentionally returns to the top. Filter changes reset the feed rather than carrying another filter's pending updates.

Touch layouts use the document as the main vertical scroll container, with sticky header and fixed translucent/blurred navigation above content. This restores the prerequisite for native Safari document-scrolling behavior. Automated desktop WebKit is not proof that physical iPhone status-bar tap-to-top or browser chrome collapse was exercised.

Touch text-entry controls have a 16px computed-font floor while pinch zoom stays enabled. Browser zoom restrictions such as user-scalable=no and maximum-scale=1 are not added. Desktop type geometry is unchanged. The dock's translucency is updated; automatic dock collapse and long-press-to-menu integration remain open.

Catalog counts are workspace-scoped server totals independent of loaded pagination. Sidebar counts include All issues, My issues, Epics, Projects, Cycles, Documents, Initiatives and Archive. Navigation accessible names remain stable; counts are supplied separately as descriptions. Zero counts are real zeros, not loading placeholders.

## Verification and known boundaries

The old source failed explicit browser assertions for 12px touch input text, scrollY remaining zero, and missing sidebar hold behavior. Public-worker unit tests, live-feed models and server-count tests started red and passed after implementation. The held-menu/collapsing-dock and private-cache cases remain separate unfinished scope; they are not counted as green.

Current source/types/build: 196 passing unit tests, one pre-existing skipped test. Whole application: 76 Chromium and 76 WebKit scenarios passed on separate fresh synthetic servers. Storybook: 20 interaction/accessibility checks passed. A new built-shell diagnostic verified Chromium's offline navigation from the actual Service Worker (six public cache entries, zero cached private API responses; measured shell DOM at 37ms on this Mac, not a universal speed promise).

The same diagnostic failed under Playwright WebKit setOffline(true) with an internal navigation error. This matches the independently reproduced upstream Playwright issue #42775, including literal no-network service-worker responses. It is recorded as an unverified automated offline-WebKit case, not a passing test. A proposed alternate origin-outage diagnostic edit was rejected before execution; no result from that alternative is claimed. The runtime diagnostic remains available with its original failing WebKit expectation.

Pixel comparisons were inspected rather than blindly accepted. The touched phone reference shows larger search text, retained 56px row heights/separators and translucent dock above page content. The board comparison additionally exposed a stale pre-knowledge/overflow-menu baseline from earlier main; its new image retains those already shipped controls and the new count badges. Current mobile reference pages 2–4 were re-read for floating dock/menu intent. This is not a measured 90% likeness of every Linear screen.

## Sources

- https://www.telerik.com/products/aspnet-ajax/documentation/knowledge-base/common-disable-autozoom-input-safari-iphone — computed text >=16px avoids focus-triggered iPhone zoom. The alternative viewport restriction is deliberately not used.
- https://web.dev/learn/pwa/update — render the existing app without waiting for update checks; update lifecycle boundaries.
- https://web.dev/learn/pwa/service-workers — versioned worker lifecycle and waiting activation.
- https://github.com/microsoft/playwright/issues/42775 — independent reproduction of WebKit offline-emulation rejecting locally served worker responses.

## Still open outside this increment

Persistent authenticated read models, full offline content access, animated hold-to-open in every sidebar/context surface, scroll-driven dock collapse, team deletion UI/API, and the prior keyboard/People/Slack features are not made complete by this release. Original screenshots remain in private Library, not source control. Content migration and Linear synchronization are owned by the user's other agent.

## Follow-up review fixes

The completed first review found no release blockers. Concrete smaller findings were corrected and checked: changed-then-departed rows no longer double-count the update badge; a temporarily frozen group keeps its matching status glyph until review; dismissed app-update notices can be offered again; redundant count announcements were removed. Catalog counts refresh every 30 seconds while active.

Retained old shell caches now serve already-open tabs' versioned lazy imports. Unknown public versioned assets can fall back to the network but are never added to the cache. Only the bounded current/two-previous application caches are searched. The manifest version includes worker code so changes to cache behavior cannot accidentally reuse an old cache name.

An additional real-browser regression reproduced explicit Load more being wrongly treated as an unsolicited arrival. User-requested next-page records now appear immediately while unrelated live arrivals remain behind the badge. This passed in Chromium/WebKit alongside stable-slot and one-at-a-time update tests. Unsolicited reordering and status regrouping still wait for Review updates.

Admin access was rechecked through connected tools: current Linear identity is an administrator, and the connected Slack identity is an administrator/owner. Neither supplies the backend with a bot installation. Vercel metadata still has no Slack bot/signing/workspace/channel variables or Linear webhook signing variable. A new isolated Chrome setup window was opened, but reading its dashboard via Apple Events was rejected because Chrome's Allow JavaScript from Apple Events is disabled. That security setting was not changed and the isolated window was closed. No existing tabs, passwords, tokens or provider settings were modified.

The second review identified unnecessary polling by the always-mounted command palette and unbounded per-window request multiplication. A real browser clock regression reproduced the hidden poll and now passes in both engines. Live polling is opt-in for the list observer only; the closed/empty palette observer is disabled. Loaded pages refresh as a coherent cursor window on an adaptive interval rather than independently refreshing only page zero and misclassifying shifted records as departures. Two policy tests verify the fixed average request budget. Catalog polling also stops after an unauthenticated/error result.

## Final release verification

Final source, independent TypeScript and build checks passed: 201 unit tests passed, one pre-existing test skipped (202 total). The completed whole-browser runs passed78 Chromium and78 WebKit cases; Storybook20/20; visual regressions6/6; secret scan passed. Logs use `/tmp/tasks-mobile-release-typed-source.log` and `/tmp/tasks-mobile-shipping-{chromium,webkit,storybook,visual,secrets}.log`.

Third ordinary review completed correctness/performance/quality with no release blockers and confirmed the bounded adaptive polling design. Earlier security review found no blocking exploit. After review, one erased TypeScript generic annotation (`useInfiniteQuery<Page<Issue>>`) resolved inference of the callback; it changes no runtime behavior and all final gates above were rerun afterward. The separate offline-WebKit diagnostic remains unpassed for the documented upstream limitation.
