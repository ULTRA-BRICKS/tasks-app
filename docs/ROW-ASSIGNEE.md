# Row and board assignee control

Task identity: UB-43 / `da21d23a-ce17-40f6-811f-db61f038f6f3` (resolve by UUID; codes were renumbered). Builds on UB-29 (canonical people, [PEOPLE-IDENTITY.md](PEOPLE-IDENTITY.md)), UB-30 (searchable comboboxes, [SEARCHABLE-COMBOBOX.md](SEARCHABLE-COMBOBOX.md)), UB-77 (View profile, [PERSON-POPOVER.md](PERSON-POPOVER.md)) and the board card wrapper of UB-38 ([TASK-PREVIEW.md](TASK-PREVIEW.md)). No database migration and no server change.

## Requirement

Clicking a list or board assignee avatar opens that task's searchable assignee picker instead of doing nothing. Acceptance criteria from the task:

1. A real named button supports pointer, Enter and Space, leaves the task URL and row selection unchanged, and shows the current assignee.
2. Suggestions show avatar, name, email where useful and Unassigned; a selected value survives a refresh.
3. A viewer may inspect but not assign; the server's role and version checks stay authoritative.
4. Tests cover a one-task update, Shift-click non-assignment, 403/409/failure rollback, focus restoration and mobile popup bounds.

## Control

`IssueAssignee` (`src/features/issue-edit/assignee.tsx`) is the avatar of every list row and board card. It is the shared `Combobox` trigger: a `<button role="combobox">` named `Assignee for <KEY>: <current assignee or Unassigned>`, showing that person's avatar. It is a sibling of the row's open button and selection checkbox (a board card is a wrapper, TASK-PREVIEW.md), so a press on it never reaches task navigation.

- Pointer, Enter and Space open the picker. Space on the task's open button peeks (TASK-PREVIEW.md, P7); Space on the avatar is the button's own activation and opens the picker.
- Opening, searching and closing change nothing: not the URL, not the row selection, not the value.
- Choosing an option sends one `PATCH /v1/issues/<id>` with that task's `version`, and nothing for any other task. The list updates optimistically; any error rolls back to the previous assignee and shows the server's message in a `role="alert"` beside the avatar. Focus returns to the avatar after a choice and stays there after a failure. While the save is pending every option is disabled, but the trigger stays enabled: Base UI renders a disabled trigger as a native `disabled` button, and disabling the focused button dropped focus to the page after every choice (found by the focus test, 30 Sep).
- **Shift-click** is not a range-selection gesture on this control. The avatar ignores the modifier: Shift-click opens the picker like a click, writes nothing until an option is chosen, and never adds or removes selected rows. Range selection belongs to the rows' selection controls (checkbox and keyboard), never to a control inside the row. Rejected: making Shift-click on the avatar select a range. The same pointer gesture would then assign on one part of the row and select on another, and a person aiming at the avatar would lose the picker.
- A viewer can open the picker and read the suggestions; every assignment option is disabled. Missing permission information fails closed the same way (`disabled` defaults to true). The server still rejects viewer writes with `403 READ_ONLY` and stale versions with `409 VERSION_CONFLICT`; the client never decides alone.

## Suggestions

`assigneeOptions` (`src/shared/lib/people.ts`) builds the list from the UB-29 directory: `Unassigned` first, then one option per canonical person with avatar and canonical name. The row avatar picker and the task preview's Assign choice share it.

- **Email.** A person's email is the option's description when the live catalog supplied one and nothing more important must be shown there: a bot keeps `Bot`, and records held apart for review keep their providers and `Needs review` (they share the email, so it would not tell them apart). This follows the email decision in PERSON-POPOVER.md: after session confirmation the catalog is the authority (it sends emails to every workspace role, as the People page shows) and there is no client redaction. Before confirmation, a saved copy strips emails at every depth (PERSISTENT-READ-CACHE.md), so it has none to display.
- **Search.** The query matches the displayed name, every other name the person is known by (member, Linear and Slack profiles grouped by UB-29) and the email, also where a bot or review label replaces it. `Combobox` options carry the extra terms as `keywords`: searched, never displayed. Commands such as View profile still hide while typing.
- **Layout.** The popup stays at most `min(360px, var(--available-width))` wide and keeps the shared popup padding: 8 px from every viewport edge, plus the safe-area insets and the phone dock (`usePopupCollisionPadding()`, [PHONE-OVERFLOW.md](PHONE-OVERFLOW.md)). The description sits on its own line under the name and wraps anywhere, so a long email neither squeezes the name nor runs past the popup (`.picker-item:has(> .picker-item-description)` in `src/app/styles.css`). Each leading decoration (a colour swatch, an avatar) keeps a column of its own before the name, and the check follows the name; the rule holds for none, one or both decorations (Chromium and WebKit layout probe in the PR evidence, 30 Sep), because `Combobox` renders a swatch and an avatar together when an option carries both. This is deliberately the layout of every picker option with a description, so the same person looks the same everywhere: a `Bot` or `Linear · Needs review` note in the task properties' Assignee, a filter, project lead or initiative owner also moves under the name (visual proof: `desktop-1440-chromium-property-review.png` in the PR evidence).

Rejected: an email under every name in all person pickers. Filters, project lead and initiative owner list many people in short menus where the name is enough; they keep their plain options and only share the layout of the notes they already had. Rejected: the email beside the name, right-aligned like the old description. In a 240 px popup it squeezed names onto two lines and ran past the popup's edge (red phone test, 30 Sep). Rejected: scoping the stacked layout to the assignee popup. A person's Bot or review note would then sit beside the name in one picker and under it in another.

## Out of scope

- Physical iPhone tap check (SEARCHABLE-COMBOBOX.md, _Touch selection_). Playwright WebKit cannot tap a Combobox option (UB-83), so WebKit tests choose options with `click()`.
- Bulk assignment of selected rows, and range selection itself (keyboard/selection work).
- The Estimate popup under the phone dock (UB-32).

## Acceptance mapping

| Criterion | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | `tests/e2e/row-assignee.spec.ts`: Enter and Space open the picker without a peek; opening keeps the URL and the selected rows; the trigger names the current assignee. `people-layout-feedback.spec.ts`: pointer opens, Escape restores focus. `task-preview.spec.ts`: board card control beside the open button.                                                                                                                  |
| 2         | `row-assignee.spec.ts`: suggestions show avatar, name and email, `Unassigned` has none; search by email and by another profile's name; an assignment survives a reload. `tests/unit/people-directory.test.ts`: description and keywords per person kind (member, bot, review record, no email).                                                                                                                                    |
| 3         | `people-layout-feedback.spec.ts` and `person-popover.spec.ts`: viewer options disabled, no write. `row-assignee.spec.ts`: a server `403` rolls back.                                                                                                                                                                                                                                                                               |
| 4         | `row-assignee.spec.ts`: one PATCH for the chosen task while every other row and server record stays unchanged; Shift-click writes nothing and changes no selection; `403` and `500` roll back with a visible error and keep focus on the avatar; focus returns after a choice; popup inside the viewport at 320/375/393/430 px for a row and a board card (Chromium and WebKit). `people-layout-feedback.spec.ts`: `409` rollback. |
