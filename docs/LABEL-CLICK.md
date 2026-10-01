# Label chip opens the task and focuses its labels

Ticket: UB-99 (df87b373-cb95-4fcf-815f-cf396227ea88). User feedback, 30 September 2026 (Russian): «при клике по лейблу в списке тикетов тикет не открывается / я думаю идеально открывать тикет и фокусить лейблы». Related: UB-36 (shortcut registry).

## Defect

A label chip in a list row (`.label-pill` in `IssueRow`, `src/entities/issue/ui.tsx`) is a plain `<span>`. The row itself is only the `issue-open` button plus separate controls, so a click on the chip lands on nothing: a dead zone. The same chips in the task preview (`IssuePeek`) are inert too, and on a phone (≤ 900px) the row hides its labels, so the preview is the only place a phone user can tap one.

## Decisions

**Follow the ticket verbatim: open the task page, then focus the Labels property.** Acceptance criteria ask for the same destination as a row click ("page or preview per current setting"; today a row opens the page) and for keyboard focus on the labels picker trigger afterwards. Focus is _moved to_ the trigger (button, accessible name "Labels"); the picker is **not** opened, so the person chooses between Enter/Space to edit and Tab/Escape to carry on. Rejected: opening the picker popup (the ticket says focus, and an opened popup would steal typing from a person who only wanted to read the task); filtering the list by the clicked label (a different feature, not requested).

**The chip is a real button, a sibling of the open button.** `<button type="button" class="label-pill label-pill-button">` next to `issue-open`, never nested inside it (a button inside a button is invalid and breaks row semantics). Accessible name `Edit labels of <KEY>: <label>` so rows with the same label are distinguishable; it appears in the natural tab order after the row's open button. Keyboard path: Tab to the chip, Enter or Space activates it — the same result as a click. The row keeps its single open button; Space on the open button still peeks.

**How focus survives navigation.** The opener navigates with router state `{ focus: 'labels' }` (`/tasks/<id>?<list params>`). `IssueProperties` reads it and hands the request to the Labels picker, which takes focus once its trigger is mounted and enabled (the page may still be loading, or the properties disabled while a write is pending), then replaces the history entry without the flag so reload, Back and Forward do not steal focus again. For a read-only person (viewer) the trigger stays disabled: the page opens normally and focus is not forced anywhere, because a disabled control cannot hold it.

**Preview chips.** The chips in the preview are the same button (`Edit labels of <KEY>: <label>`); activating one closes the preview through the existing navigation rule (a changed location closes the preview) and opens the page with the same state. This is the phone path, where rows show no labels.

**Visible focus.** Focus moved by script after a pointer click is not `:focus-visible`, so the browser would draw no ring and a mouse user could not see where focus went. The Labels trigger therefore carries `data-landed` from the moment focus lands until it blurs, styled like `:focus-visible` (accent outline). Keyboard users get the native ring either way.

**Hold and press gestures.** A touch/mouse press that starts on the chip is a click, like the assignee control; the row's hold-to-preview starts elsewhere on the row. Tab order in a row is now open button → label chips → assignee, so Shift+Tab from the assignee lands on the last chip (`person-popover.spec.ts` follows this).

**Board cards stay as they are.** The card footer shows the first label's name _inside_ the card's open button (nested buttons are invalid), so the whole card, including the name, already opens the task. Out of scope; no focus request is made there. The preview opened from a board card shows the same chips and the same behaviour as the list preview.

## Acceptance criteria → tests

| Criterion                                                                                             | Test                                                                                               |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Clicking a row label chip opens that task page                                                        | `tests/e2e/label-click.spec.ts` `clicking a label chip in a row opens the task and focuses Labels` |
| Focus lands on the Labels trigger (accessible name "Labels") with a visible ring; picker stays closed | same                                                                                               |
| Chip is a sibling button, not nested; keyboard Tab + Enter gives the same result                      | `a label chip is a sibling of the open button and works from the keyboard`                         |
| Focus is not requested again on reload                                                                | `the focus request is consumed: a reload does not move focus again`                                |
| A plain row click still opens the task without moving focus to Labels                                 | `a row click outside the chips still opens the task without moving focus to Labels`                |
| Phone: tapping a chip in the preview opens the task and focuses Labels                                | `tapping a label in the preview opens the task and focuses Labels`                                 |

Chromium and WebKit both run all of these; the phone case uses a 390×844 context.

## Out of scope

Filtering the list by label, the board card footer, label editing semantics, the shortcut registry (UB-36).
