# Searchable comboboxes with explicit inline creation

Task identity: UB-30 / `1247c85e-51f6-4446-9f8e-af4e351cc8cf` (resolve by UUID; codes were renumbered). No database migration.

## Requirement

Use search in appropriate selectors and permit creating a typed missing value where entity rules and user permissions allow. Acceptance criteria from the task:

1. Preserve value, IME, keyboard navigation, Escape and accessibility; people results include avatars.
2. Only explicit Create triggers a write; typing and blur never create objects.
3. Required extra fields open normal page-first creation retaining typed input and return context.
4. No implicit accounts or status-enum creation; viewers cannot create; handle concurrent matches, idempotent retry, 403/409/offline.

## Primitive

`Combobox` in `src/shared/ui/combobox.tsx` wraps the installed Base UI 1.8 `Combobox` in its _input inside popup_ form. The resting control stays the compact property value (`.picker`), so rows and property rails keep their geometry; `Picker` (Base UI `Select`) remains for short menus that are not workspace data.

- Trigger: `role="combobox"`, `aria-haspopup="dialog"`, `aria-expanded`, named by the field (`Status`, `Assignee`, …), so existing `getByRole('combobox', { name })` callers keep working.
- Popup: a search input named `Search <field>` (`role="combobox"`, `aria-autocomplete="list"`, virtual focus through `aria-activedescendant`), a listbox named after the field, options with `aria-selected`, an empty state and one polite status region for create feedback (errors use `role="alert"`).
- Value: opening, typing, Escape, Tab and outside clicks never change the value. The query starts empty each time the popup opens. Selecting an option commits exactly once and returns focus to the trigger.
- Create feedback lives in the popup, so it is never lost: when an existing match is selected instead of created, a single-select popup stays open with the notice; when a create fails after the popup was closed, the popup reopens with the typed text and the error.
- Keyboard: ArrowUp/ArrowDown move the highlight (looping to the input), Enter chooses the highlighted option, Escape closes and restores focus to the trigger. Escape is consumed by the popup, so page shortcuts (Escape → back from a task) do not run.
- IME: Base UI ignores Enter while composing (`keyCode 229`) and keeps the composing text out of controlled updates; no option is chosen and nothing is created until composition ends.
- People: options render the avatar (image or initials) beside the name; search matches the displayed name and the option's `keywords` (never shown). Assignee suggestions add the person's other names and email ([ROW-ASSIGNEE.md](ROW-ASSIGNEE.md), UB-43).
- Multiple mode (labels) keeps the popup open after each toggle and shows a check for selected values; label options show their colour swatch.
- Commands (`actions`): non-value items such as `View profile` lead the list while the query is empty and hide as soon as the person types, so Enter after a search always picks a match. Choosing one closes the popup and runs its `onSelect`; it is never selected, saved or checked, and the value does not change. UB-77 uses this for the assignee picker's profile link.

## Touch selection

Checked 30 Sep 2026 after a WebKit phone test tapped an option and nothing was chosen. A tap chooses an option. A swipe that starts on an option scrolls the list and chooses nothing. The wrapper adds no touch handling. Base UI 1.8 `Combobox.Item` cancels `pointerdown` and `mousedown`, so the search field keeps focus and the phone keyboard stays up. It chooses on the `click` that follows the tap. A swipe ends in `pointercancel` and never produces that click.

Cancelling `pointerdown` suppresses only the compatibility `mousedown` and `mouseup`, not `click` (WPT `pointerevent_suppress_compat_events_on_click.html`). Engines differ in how closely they follow that:

| Engine                                                   | Tap after a cancelled `pointerdown`              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Safari 26 and 27                                     | `click` fires; the option is chosen              | WebKit 211458@main (2019) and its iOS test `pointer-events-prevent-default-allows-click-event.html`. An iOS change that suppressed this click (310491@main, spring 2026) was reverted on 29 May 2026 (314097@main, test `click-event-after-pointerdown-prevent-default-on-ancestor.html`), before Safari 27 shipped. Safari 27 also restored the `mousedown` suppression (312396@main). The Base UI maintainer could not reproduce a failed tap on iOS 26.5 or Android Chrome 148 ([mui/base-ui#5066](https://github.com/mui/base-ui/issues/5066)). That reporter's iOS 27 beta 1 failure was gone in beta 2. |
| Android Chrome; Playwright Chromium with touch emulation | `click` fires; the option is chosen              | Probe at 390×844 (`hasTouch`, `isMobile`): `touchscreen.tap`, raw CDP touch events and a CDP tap gesture chose an option in the row assignee, Status, Priority and Assignee pickers                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Playwright WebKit; WebKitGTK and WPE touch devices       | no mouse event and no `click`; nothing is chosen | WebKit's non-iOS touch path treats a touch whose `pointerdown` was cancelled as handled (310827@main, April 2026). Playwright's `fakeTouchTap` then synthesizes no mouse events at all, `click` included. The same probe failed in every Combobox. On a plain page without Base UI, a tapped element whose `pointerdown` is cancelled gets no `click` either, while Chromium sends it. The pre-UB-30 `Select` pickers were chosen in both engines, because `Select` never cancels `pointerdown`                                                                                                               |

Consequences:

- The phone e2e tests (`touch phone` in `tests/e2e/searchable-combobox.spec.ts`) tap and swipe in Chromium only. WebKit phone tests choose Combobox options with `click()`: mouse input, not proof of a tap. Storybook runs Chromium without touch emulation, so its play tests cannot tap either.
- Automated WebKit is not iOS. One manual check on a physical iPhone is still needed: tap an option in a row assignee picker, the Status picker and the Labels picker, and swipe the Estimate list.

Rejected:

- Choosing on `pointerup`/`touchend` in the wrapper (cancel `touchend`, then click the option). Playwright WebKit taps would pass. But the wrapper would take over the tap, scroll, momentum-stop and long-press rules from the browser on the device where they already work. A browser that still sent the click would choose twice, or its click would land on whatever lies under the closed popup. The only proof would be an emulator that is known not to behave like iOS.
- Not cancelling `pointerdown` for touch. Base UI uses that event to tell a drag-to-select `mouseup` from a tap. Without it, a tap chooses on `mouseup` and again on `click`.
- A Base UI upgrade. 1.8.0 is the latest release, and `master` keeps the same item handlers.

## Per-field eligibility

| Field                                                                            | Search            | Create                                                                       |
| -------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| Labels                                                                           | yes               | **inline**: `Create label “…”`                                               |
| Milestone                                                                        | yes               | **inline**: `Create milestone “…”` in the task's project                     |
| Project (task properties)                                                        | yes               | **page-first**: `Create project “…”…` opens `/projects/new`                  |
| Cycle                                                                            | yes               | **page-first**: `Create cycle “…”…` opens `/cycles/new` (dates are required) |
| Status, priority, estimate, team, role, project status/health, initiative status | yes               | never (no status-enum creation)                                              |
| Assignee, project lead, document owner                                           | yes, with avatars | never (no implicit accounts or invitations)                                  |

The Create option appears only when the trimmed query is non-empty, no existing option matches it case-insensitively (all options, not just visible ones), the caller permits creation and the actor is not a viewer. It sits after matching options. Choosing it with a click or Enter is the only write trigger; typing, blur, Escape, Tab, outside clicks and closing never create.

### Inline creation (labels, milestones)

Milestones have no required field beyond a name once the task's project is known, so they follow the inline rule rather than page-first creation (there is also no milestone page).

1. Before sending, the latest list is refetched. A case-insensitive match created meanwhile is selected instead of creating a duplicate (concurrent match), with the status `Selected existing label “…”`.
2. `POST /v1/labels {name, color:'#a694ff'}` (the Settings default colour) or `POST /v1/milestones {project_id, name}` carries `Idempotency-Key`. The key is stable per exact payload while the picker is mounted and is dropped after success or a definitive 4xx. A retry after a lost response usually finds the committed object in step 1; when that refetch fails too (the cached list is used), the same key replays the first result instead of creating a second object. The server reuses the existing `idempotency_keys` table through `createIdempotently`.
3. Success adds the object to the cache and selects it (labels are added to the task's labels; the milestone becomes the task's milestone).
4. `409 ALREADY_EXISTS` (a concurrent label with the same name won the unique constraint): refetch and select the existing object. If that refetch fails too, the alert says `A label named “…” already exists. Try again to select it.` (the retry's step 1 finds it). Milestone names are not unique on the server, so step 1 is their concurrent-match check.
5. `403`: `You don't have permission to create …`; nothing is selected.
6. Offline (`navigator.onLine === false`): the Create option is disabled and says `Offline — reconnect to create`. A network failure while sending shows `Couldn't reach the server …` and choosing Create again retries with the same key.

### Page-first creation (projects, cycles)

Choosing `Create project “Q4 launch”…` writes nothing. It navigates to the normal draft page with router state (never URL parameters):

```ts
{ defaults: { name: 'Q4 launch', team_id }, from: '/tasks/UB-12', fromState }
```

`from` is the existing return-path convention of the new-task page; `fromState` is that page's own router state. The draft title is the typed text and the team is the task's team (an unknown team falls back to the first team). The draft is namespaced by these defaults, so an unrelated earlier project draft is not overwritten. `Back to task` (or `Back to new task`) returns to the originating path with its router state, so a `/tasks/new` draft is restored. Only same-application paths are followed. After Create, the route is replaced by the durable project/cycle, keeping the return context; the task's picker then lists it.

Rejected: automatically assigning the new project/cycle to the task on return. It would be a second implicit write on the task that can hit version conflicts after an arbitrary delay on another page.

## Permissions and server contract

Viewers keep read-only (disabled) pickers and never see Create. The server remains authoritative: label and milestone creation require `write` (viewers get `403 READ_ONLY`) whether or not a key is sent, and a denied request stores no idempotency record. Reusing a key with a different payload or operation returns `409 IDEMPOTENCY_CONFLICT`.

## Out of scope

- Task list filters and bulk status (`src/pages/issues/ui.tsx`), relationship type and API token scopes keep `Picker`.
- Row/board assignee changes, and email and alias search for people, are UB-43 ([ROW-ASSIGNEE.md](ROW-ASSIGNEE.md)) and UB-29.
- Page-first project creation from a document's Project field or an initiative's Link project picker: both are searchable but offer no Create in this increment, because a knowledge document has no team to seed a project draft.
- Creating accounts, statuses, teams or roles from a picker.

## Acceptance mapping

| Criterion | Evidence                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1         | `src/shared/ui/combobox.stories.tsx` play tests with axe (search, keyboard, Escape, IME, avatars); `tests/e2e/searchable-combobox.spec.ts` search/Escape on a real task                                                                                                                                                  |
| 2         | Stories and e2e: typing, blur and Escape send no create request; only the Create option does                                                                                                                                                                                                                             |
| 3         | e2e: project and cycle page-first prefill and return                                                                                                                                                                                                                                                                     |
| 4         | `tests/unit/inline-create-idempotency.test.mjs` (retry, key conflict, 409, viewer 403); e2e viewer, 409 concurrent match, lost-response retry with a failed refetch (same key, one label) and offline (pointer and Enter send nothing)                                                                                   |
| Touch     | e2e `touch phone` (Chromium, 390×844 with touch): a tap chooses exactly one option in the row assignee, Status and Labels pickers (one save per tap; Labels stays open and toggles back); a swipe starting on an Estimate option scrolls the list and saves nothing. Physical iPhone check outstanding (Touch selection) |
