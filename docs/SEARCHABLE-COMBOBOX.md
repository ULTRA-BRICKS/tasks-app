# Single-input searchable comboboxes and rounded picker states

Task identities: UB-30 (prior searchable-picker work), UB-104 (single input) and UB-98 (rounded open state). No database migration.

## User decision

> «некоторые селекты все еще зачем-то добавляют отдельный инпут для поиска, вспомни что я говорил про комбо боксы! надо единый инпут и для поиска и даже для добавления нового и по нему же кликаем чтобы открывать выпадушку … и еще при открытии выпадушки некрасиво выделяется прямоугольник внутри округлого контрола … для комбобоксов и мультиселектов посмотри хорошие компоненты в base ui если там такие как мне нужны есть / у нас же base ui/shadcn надеюсь?»

The app owns shadcn-style wrappers in `src/shared/ui` and uses installed `@base-ui/react` 1.8. The supported Base UI parts are `Combobox.Input`, `InputGroup`, `Trigger`, `Chips`, `Chip`, `ChipRemove`, `Empty`, `Status`, `Group` and `Clear`.

## Required interaction

`Combobox` in `src/shared/ui/combobox.tsx` is the only searchable picker primitive.

- The control itself contains exactly one Base UI `Combobox.Input`. It is the named `role="combobox"` surface for the current value, opening, typing and explicit creation. `openOnInputClick` opens the list on pointer/touch input; Enter and Space open a closed control without navigating its row; keyboard focus and Arrow navigation retain Base UI semantics.
- A `Combobox.InputGroup` owns the control outline, selected decoration/value, optional chevron and focus treatment. The popup contains only `List`, `Empty`, `Status`, feedback, value options and explicit Create/command actions. It never contains another input.
- On a single-value control, the closed and opened input presents the selected option while its logical search query is empty. Its selected text is ready to replace on the first typed character; the query is never inferred from the display label. Opening, typing, blur, Tab, Escape and outside press never commit a value. Choice commits once; Escape restores focus to that same input and never reaches page-level Escape shortcuts.
- `actions` remain non-value options: for example, **View profile** leads an empty assignee list, hides while a query exists, closes when invoked and never changes/saves the value.
- Filtering includes `Option.label` and hidden `Option.keywords`; people options retain avatar, canonical name and allowed description. The row-assignee avatar remains the visible control for its selected person.
- Base UI handles `aria-activedescendant`, listbox/options, IME Enter (`keyCode 229`), keyboard navigation and focus. The wrapper must not replace those handlers with custom touch selection.

### Multiple values

Labels use `multiple` plus `Combobox.Chips`, `Combobox.Chip` and `Combobox.ChipRemove` inside the same `InputGroup` as the one search input. Chips render in controlled-value order, including a fallback for a temporarily missing catalog option, so Base UI's positional removal always addresses the visible chip. Each chip keeps its swatch/name and exposes a named remove button. With an empty query, Base UI Backspace moves to/removes the final chip; removing with a chip button or keyboard calls the ordinary controlled `onChange`. The list stays open after a label toggle and the input retains focus.

### Pending selection lock

`readOnly` is the wrapper's temporary pending-save lock: it keeps the input focused and lets a person inspect/filter the current list, but every value change is cancelled before it reaches the caller. The editable search input exposes `aria-busy`, not `aria-readonly` or native `readonly`; a nonmatching query can show the disabled explicit Create action with its `Saving…` reason.

### Explicit creation

The Create option appears only for a non-empty trimmed query with no exact case-insensitive option match, when the caller permits creation and the actor is not a viewer. It follows matches. Choosing Create by click or Enter is the only write trigger; typing, composition, blur, Escape, Tab, outside press and popup close never create.

- **Labels and milestones:** inline creation. The existing refetch/idempotency/409/403/offline behavior remains: a concurrent exact match is selected; failure preserves the query and retry key.
- **Project and cycle task properties:** page-first creation. Choosing Create opens the normal draft route with typed title and return state; it does not create or attach anything from the picker.
- **Never create:** accounts/invitations, teams, statuses, roles, priority, estimate, project status/health or initiative status.

A viewer can inspect a picker where that is already permitted, but options that would mutate an issue are disabled and Create is absent. Server-side roles, versions, 403, 409 and offline failures remain authoritative.

### Touch selection

Base UI 1.8 intentionally cancels item `pointerdown` so the input stays focused, and chooses from the following click. Chromium touch emulation proves `touchscreen.tap` on the input opens a list and an option tap chooses once. Playwright WebKit's non-iOS touch shim suppresses that click after cancelled `pointerdown`; WebKit picker-option tests use `click()` rather than pretending an emulated tap is iPhone evidence. No wrapper `pointerup`/`touchend` fallback is allowed: it would steal scrolling/long-press semantics and can double-select on engines that already emit click.

## Picker inventory and classification

Searchable workspace data and every existing editable property `Combobox` use the shared single-input primitive. Short enumerations already implemented as owned Base UI `Picker` remain non-searchable. A later enum migration may choose `Picker` only where direct type filtering and creation are not required; it must not introduce a native select or another picker convention.

| Location                                                                        | Fields                                                                        | Classification and reason                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/issue-edit/assignee.tsx:46`                                       | row assignee                                                                  | Combobox: people can be numerous; avatar and keywords are required; never Create.                                                                                                                                                                     |
| `src/features/issue-properties/ui.tsx:98-219,266`                               | Team, Status, Priority, Assignee, Estimate, Cycle, Project, Milestone, Labels | Combobox: these existing editable property controls receive the single-input cutover. Workspace entities can be large; static priority/estimate retain direct type filtering. Cycle/project are page-first Create; label/milestone are inline Create. |
| `src/pages/knowledge/ui.tsx:237,252,267,306`                                    | document Project, initiative Status/Owner, Link project                       | Combobox: current document properties share the input primitive; project/person collections need search and status remains keyboard filterable. No creation is allowed in these contexts.                                                             |
| `src/pages/planning-document/ui.tsx:550,561,572,590`                            | Team, Project status/health, Project lead                                     | Combobox: existing planning document properties share one input; people retain avatars and keywords.                                                                                                                                                  |
| `src/pages/planning/ui.tsx:240`                                                 | project-card health                                                           | Combobox: current dense-card implementation receives the single-input behavior.                                                                                                                                                                       |
| `src/pages/settings/ui.tsx:226`                                                 | member role                                                                   | Combobox: existing role control receives the single-input behavior; confirmation and server authorization remain authoritative.                                                                                                                       |
| `src/features/people-invitations/index.tsx:95`                                  | invite role                                                                   | Combobox: existing invitation role control receives the single-input behavior; no account creation from a picker.                                                                                                                                     |
| `src/pages/issues/ui.tsx:289-368`                                               | list filters and bulk status                                                  | Picker: URL filter/bulk command controls are intentionally out of this property-editor change; they neither create data nor add a popup search field.                                                                                                 |
| `src/shared/ui/press-preview.tsx:485`                                           | preview toolbar choices                                                       | Picker: short contextual command choices.                                                                                                                                                                                                             |
| `src/widgets/issue-details/ui.tsx:558`                                          | relation type                                                                 | Picker: three fixed relation verbs.                                                                                                                                                                                                                   |
| `src/pages/settings/ui.tsx:346`                                                 | API-token permission                                                          | Picker: short security-sensitive enum.                                                                                                                                                                                                                |
| `src/shared/ui/primitives.stories.tsx` and `src/shared/ui/combobox.stories.tsx` | fixture controls                                                              | Test only: exercise the owned Select and Combobox primitives respectively.                                                                                                                                                                            |

## Rounded controls and highlights (UB-98)

The reported inner rectangle comes from the phone property rail: `.detail-properties .compact-property` owns the rounded pill and leading icon, while its nested `.picker[data-popup-open]` paints a second rectangular hover/open background. The nested painting starts after the icon and does not share the pill boundary.

| Surface                                                            | Owner of focus/open/selected geometry | Required treatment                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Combobox` and `Picker` standalone controls (`src/app/styles.css`) | `.picker` / `Combobox.InputGroup`     | The same root owns border, background, hover/open state and radius. The input itself has no independent border/background/outline.                                                                  |
| Phone property rail (`.detail-properties .compact-property`)       | `.compact-property`                   | The outer rounded pill contains the leading icon and owns open/focus background, border and visible focus ring. The nested picker is transparent, borderless and does not paint an inner rectangle. |
| Popup options (`.picker-item`)                                     | option itself                         | Highlight/selected background stays clipped to its token radius; decorations remain in the existing grid/flex layout.                                                                               |
| Action menus (`.page-menu-popup`, `.page-menu-item`)               | menu trigger/item                     | Keep the existing rounded popup and rounded highlighted items; any open trigger state must inherit its own control radius.                                                                          |
| Date property (`date-property.css`)                                | `.date-inline` / calendar button      | The rounded property shell owns focus. The text input must not render the global rectangular input outline inside it; calendar buttons retain their own rounded focus treatment.                    |

Keyboard focus stays visible: a paint-only accent ring follows the owner’s radius and meets the existing contrast contract. No visual baseline is refreshed merely to accept this correction.

## Acceptance mapping

| Requirement                                                    | Evidence                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input click opens, same input filters, popup has no text input | `src/shared/ui/combobox.stories.tsx` and `tests/e2e/searchable-combobox.spec.ts`: input focus, filtered options, `role=textbox` count inside popup is zero.                                                                 |
| Keyboard, Escape, IME and focus                                | Storybook axe/play tests plus `searchable-combobox.spec.ts`, `row-assignee.spec.ts`, `people-layout-feedback.spec.ts` and `person-popover.spec.ts`.                                                                         |
| Explicit Create and failure behavior                           | Existing label/milestone/project/cycle E2E paths, now typing through the control input; only Create sends a write.                                                                                                          |
| Multiple chips and removal                                     | Storybook `multiple` play test plus E2E label selection: named ChipRemove, Backspace, focus remains in the input and the popup remains open.                                                                                |
| Chromium phone input tap and WebKit option behavior            | `searchable-combobox.spec.ts`: Chromium `touchscreen.tap` opens input/list; option selection uses `click()` in WebKit.                                                                                                      |
| Rounded open state                                             | Chromium and WebKit E2E geometry checks prove the mobile outer pill owns the open background/radius and the nested input is transparent; focus remains visible.                                                             |
| Visual evidence                                                | Real desktop 1440×900 Chromium and phone 390×844 Chromium/WebKit captures for closed/open/single-input, chips, Create and avatar assignee; 320 px layout risk capture; every PNG is read and reviewed with `review visual`. |

## Out of scope

- Physical-iPhone option-tap verification remains separate from Playwright WebKit emulation.
- New account invitations, team/status/role creation, filter-builder redesign, relation taxonomy and API-token scope changes.
- Page-first project creation from knowledge/initiative pickers, because those contexts have no safe team default.
