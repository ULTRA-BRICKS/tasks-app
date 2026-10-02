# Property controls: one surface, one set of states

Ticket: UB-101 (f5220733-72b1-4555-aa9e-65ba3f17ef59). User feedback, 30 September 2026 (Russian): «на компе контролы даты по другому реагируют на ховер и клик чем остальные, все должно быть унифицировано и иконка слева должна входить в обводку». Related: UB-41 (inline calendar, `docs/INLINE-DATE-CALENDAR.md`).

## Measured defect (desktop 1440×900, task page rail)

Evidence: `/Users/ultra/xp/.tasks-work-evidence/label-date-20260930/visual/before-*.png`.

- Status, priority, assignee, estimate, cycle, project and milestone are `.compact-property` rows: a 16px icon (`.property-icon`) **outside** and a `.picker` trigger beside it. Only the trigger paints the hover/open background and border, so the icon is outside the outline.
- The date rows are `.compact-property.date-inline` but paint nothing on hover or open, have a 44px round icon button inset 2px, and a bespoke `:focus-within` border colour. The icon column sits ~16px right of every other icon.
- The date trigger sets `cursor: pointer`; pickers keep the default cursor.

## Decisions

**The row is the control surface, for every property.** One rule block in `src/app/styles.css` (`.detail-properties .compact-property`, "Property control states") paints the row: icon and value share one border, radius (`--radius-md`) and background. States use existing tokens only:

| State               | Paint                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| rest (desktop)      | transparent 1px border; phone keeps its existing `--color-border` pill       |
| hover               | `--color-hover` background, `--color-border-strong` border                   |
| active (pressed)    | `--color-selected` background                                                |
| focus-visible       | `--color-accent` border and the 20% accent ring `.input:focus-visible` uses  |
| open (picker/popup) | as hover, while a trigger inside the row carries Base UI's `data-popup-open` |
| disabled            | no hover/active paint (`:disabled` trigger, input or `data-disabled`)        |

The pickers and the date trigger/input paint nothing themselves inside the row (transparent, no outline); the row shows the state. Because the icon is inside the surface, the picker's old hover box no longer excludes it. The Labels trigger is not a `.compact-property` (it grows with its pills) and keeps its own `.picker` styling.

**The whole row is the click target.** A picker's `::after` stretches over the row, so a press on the icon or padding opens it exactly as a press on the value does (interactive children — the assignee chip, the cycle help button — sit above it with `z-index`). In the date row the calendar trigger carries the row's left padding and the input its right padding, so the same holds there. The calendar still anchors to the row (UB-41); typing, Enter, Escape and Down-arrow keep their behaviour.

**Same cursor.** The date trigger drops its bespoke `cursor: pointer`; it inherits the default cursor like every picker.

**Phone (≤ 767px).** The rows already are bordered 44px pills with the icon inside; the date row now uses the same icon inset (10px) and gap. The trigger keeps a 44px-wide target by overlapping the input's first 10px.

**Rejected.** (a) Moving only the date icon inside an outline: the date control would still differ from the others. (b) Changing `Combobox` to render the icon inside the trigger: an API change for a styling difference, and it would split the row from the interactive icon (assignee chip). (c) Bespoke date hover/focus styles: the ticket asks for shared styles and no overrides.

## Acceptance criteria → tests

| Criterion                                                                                         | Test (`tests/e2e/property-controls.spec.ts`, Chromium and WebKit)                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Date uses the same rest, hover and focus-visible paint as another property (Estimate)             | `the date control paints hover, focus and open like another property control`                        |
| Same open state while the calendar / the picker popup is open                                     | `an open date calendar and an open picker share the open state`                                      |
| Icon inside the outline in rest, hover, focus, open                                               | `the calendar icon sits inside the outline and hover surface of the date control`                    |
| Same cursor; click target spans the row; calendar opens anchored                                  | `the date icon and the pickers have the same cursor and the whole row is the click target`           |
| Existing calendar behaviour is unchanged                                                          | `tests/e2e/inline-calendar.spec.ts`, Storybook `date-property`                                       |
| Side-by-side screenshots (rest/hover/focus/open), desktop 1440 and phone 390, Chromium and WebKit | `/Users/ultra/xp/.tasks-work-evidence/label-date-20260930/visual/` and `review visual` verdict files |

## Out of scope

Labels trigger styling, the Combobox API, project/cycle page logic, the board and list.
