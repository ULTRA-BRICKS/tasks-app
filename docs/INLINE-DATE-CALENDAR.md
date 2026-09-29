# Inline dates with an anchored calendar

User requirement: keep the existing start/due date field in place and open a compact calendar below it, rather than another form with an extra date input and Apply. Current task UB-41 / c28ed83b-2423-4d0d-b86c-381c13513c30; no account or domain migration is involved.

Design: one named text input accepts ISO date-only values and keeps invalid typing visible. Enter or blur commits valid typed dates; Escape restores the last server/draft value. A calendar icon or the input opens the same anchored nonmodal BaseUI Popover; the popup contains no input and no Apply action. Choosing a day commits it and returns focus. Navigating months never changes the property. Today and Clear are compact convenience actions. Dates are computed as calendar values in UTC rather than local-time milliseconds, preventing DST/offset date drift.

Retain the existing DateProperty(value, onChange, disabled) interface and parent version/permission/error handling. No extra component library or browser storage of credentials. Invalid local input survives errors while this editor is mounted; do not claim this solves the wider persistent workspace/draft-cache backlog.

Keyboard: one roving grid tab stop; arrows move by day/week, Home/End by week, PageUp/Down by month, Shift+PageUp/Down by year, Enter/Space choose and Escape dismiss. Use native table/grid semantics, full-date button labels and a live month heading. Input remains accessible and 16px on touch. Popup must fit 320/393/430px and safe collision boundaries without horizontal page scroll.

Evidence plan: existing two browser assertions already fail because there is no inline input. Add leap-year/month-end/date-range model tests and real-browser input, calendar, focus, month-browsing, Escape, readonly, timezone and mutation-failure cases. Check new/existing task and project/cycle callers; inspect a phone capture, not just attributes. Preserve original reference images outside Git and old APIs inside the domain layer.

Primary references: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/ for calendar keyboard conventions (the example itself is not shipped as production code); https://base-ui.com/react/components/popover for anchor, collision and focus primitives. Our panel is nonmodal so the original input stays usable.

## Review reconciliation — 27 September 2026

The selected-day accessibility failure was reproduced at 2.57:1 and fixed using the existing paired `--color-on-accent` and `--color-accent-solid` tokens; the contrast assertion remains enabled.

Today deliberately uses the person's local civil date. UTC is only the arithmetic representation of an already selected YYYY-MM-DD value, not a conversion of the person's current instant into a UTC day. Fixed-instant browser cases verify Today, `aria-current`, Clear and focus in UTC-12, UTC+14 and Europe/Belgrade. Replacing local Today with the UTC day would violate those cases.

Keyboard checks now exercise all four arrows, Home/End, PageUp/Down, Shift+PageUp/Down and Space selection without intermediate commits. A real API case verifies that moving focus from typed input into the calendar saves only the chosen day, while outside blur commits exactly once. The existing 409 case confirms that one visible mutation error retains the typed date and permits a successful retry; the next mutation clears the local error before running.

The first whole-browser run exposed a test-server lifetime defect: Chromium consumed part of the real login-attempt allowance before WebKit started. The runner now gives each engine a fresh synthetic server and distinct artifacts, without changing authentication protections. Six unit tests cover browser selection, usage errors for missing or unsupported `--project`/`--output` values, argument/report isolation and run ordering.

One desktop detail reference predated Tasks naming, current navigation and Cycle help. Expected/actual/difference images were visually inspected and preserved outside Git before accepting the intended inline date presentation; the screenshot threshold was not relaxed. These captures use synthetic data and are not a claim of production or physical-iPhone acceptance.

## Integration onto main — 29 September 2026

The branch was fast-forwarded onto `origin/main` f351153 (Linear queue recovery only) and then f87b126 (task wording); staged and unstaged calendar diffs were byte-identical before and after, and the only shared file (`src/widgets/issue-details/ui.tsx`) had disjoint hunks. Under a heavily loaded host the first full Chromium run showed the keyboard case pressing keys before the popup had moved focus to the selected day, so keys reached the trigger. The case now first asserts that initial focus, matching the timezone cases; the product behavior and every key assertion are unchanged.
