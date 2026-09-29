# Person popover

Task identity: UB-77 / `14207246-15f7-4b14-96a0-047026db7e48` (resolve by UUID; codes were renumbered). Relates to UB-29 (canonical people), UB-43 (row assignee control) and UB-30 (searchable comboboxes). No database migration and no server change.

## Requirement

User report, 29 September: «Пользователи почти нигде не кликабельны чтобы посмотреть попап» (people can almost nowhere be clicked to see a popover). Acceptance criteria from the task:

1. Every visible person — avatars and names in rows/cards, task properties, activity, comments, People page, pickers' selected values — opens a person popover (hover and focus on desktop, tap on touch).
2. The popover shows avatar, canonical name, email (if the viewer is permitted), role/membership and linked providers (Slack/Linear).
3. The popover offers an action to view the person's tasks (the task list filtered by this person).
4. On list/board rows the avatar keeps its UB-43 role as the assignee control and still offers a way to view the profile.
5. Keyboard operable (Enter/Space open, Escape closes, focus restored) with correct accessible names; viewer permissions are respected.
6. Desktop 1440×900 and phone 390×844 (WebKit and Chromium) visual proof, read back and reviewed.

## Components

Feature-Sliced Design forbids imports across slices of one layer, so the popover is split by responsibility:

| Part                                 | Layer                                         | Responsibility                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personProfile(catalog, id, viewer)` | `src/shared/lib/people.ts`                    | Pure data selection from the UB-29 projection. Unit-tested.                                                                                                                     |
| `PersonPopover`                      | `src/shared/ui/person-popover.tsx` (+ `.css`) | Presentational trigger and popup on Base UI `Popover`. Takes a `PersonProfile`; knows nothing about queries. Storybook play and axe tests.                                      |
| `PersonChip`                         | `src/entities/workspace/person-chip.tsx`      | Connected: reads `useCatalog()` and `useMe()` (the workspace entity already owns both queries), selects the profile and renders `PersonPopover`. Exported from the slice index. |

Features, widgets and pages render `PersonChip`. `entities/issue` cannot import `entities/workspace`; its row and card receive the person control through a slot, as `IssueRow` already does with `assigneeControl`.

Trigger shapes (`display`): `avatar` (avatar only, named by `aria-label`), `name` (avatar and visible name) and `text` (the visible name alone, for a name inside a line of text such as an activity entry or the People list, where an avatar would crowd the line). The 44 px coarse-pointer hit area applies only to triggers that contain an avatar; an enlarged inline name would cover the lines above and below it. `onViewTasks` runs after View tasks, so a caller can close the container the card was opened from (the phone navigation drawer).

Which ID a surface passes: the stored person of the record. Comments pass `author_source_id ?? author_id` and imported activity (`linear_imported_change`) passes `actor_source_id`, because `author_id`/`actor_id` of imported records is the member who ran the import; this mirrors the server's name resolution (`packages/server/modules/tickets/service.mjs`). Linear's own automation has no source person and stays plain text.

### Data (`PersonProfile`)

`personProfile` resolves any stored ID — member, Linear or Slack source profile — through the UB-29 alias index to one canonical person:

- `id`: canonical ID (the Tasks member ID when the person has an account).
- `name`, `avatar_url`: the canonical projection (Slack name/photo first, as in UB-29).
- `email`: see _Email permission_; otherwise `null`.
- `membership`: `Owner`, `Admin`, `Member` or `Viewer` from the member's workspace role; `Bot` for bot profiles; `No Tasks account` for imported profiles without a member.
- `accounts`: linked providers in projection order, labelled `Tasks`, `Linear`, `Slack`.
- `bot`, `needs_review`: the UB-29 flags. `needs_review` renders the same `Needs review` marker as the People page and pickers.
- `is_viewer`: the person is the signed-in actor (the Membership line reads, e.g., `Admin · You`).
- `tasks_href`: `/tasks?assignee_id=<canonical id>`. The server expands a canonical ID to every alias (UB-29), so the list includes tasks attributed to imported profiles.

An ID the directory does not know (for example a removed account whose name survives in history) returns `null`; the chip then renders the plain avatar/name without a button, because there is nothing more to show.

### Email permission

The server is the authority. `GET /api/v1/catalog` returns member and source-profile emails to every authenticated workspace role (owner, admin, member, viewer, and API tokens with `read`); the People settings page shows them to all of these roles. A client-only rule that hid emails from, say, viewers would not be an access control — the same response already contains them — and would contradict the People page.

The popover therefore shows an email only when the catalog supplied one **and** the signed-in actor is known. While `/v1/me` is loading or failed, the email is withheld (fail closed). If the product later decides that some role must not see teammates' emails, that belongs to the catalog response (server-side redaction, with the UB-29 projection moved server-side because it groups by email); the popover then needs no change, because it only renders what it is given.

## Interaction

The trigger is a native `<button>` (`Popover.Trigger`). Its accessible name is the person's name — the visible name text, or `aria-label` for avatar-only triggers — and Base UI adds `aria-haspopup="dialog"` and `aria-expanded`. The popup is a non-modal `role="dialog"` titled with the name (`Popover.Title`).

| Input                                  | Behaviour                                                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mouse hover                            | Opens after 500 ms (`openOnHover`); moving into the card keeps it open; leaving closes it after 200 ms. Focus does not move.                                                                                                  |
| Keyboard focus (`:focus-visible` only) | Opens after the same 500 ms without moving focus. Tab moves into the card, Tab past its last control continues after the trigger, and focus leaving both closes it. A mouse click's focus does not trigger it.                |
| Click, tap, Enter, Space               | Opens and moves focus into the card (first control for mouse/keyboard; the card itself for touch, so no virtual keyboard). On a card already opened by focus or hover, Enter/Space moves focus into it instead of closing it. |
| Escape                                 | Closes and returns focus to the trigger (when focus was inside the card).                                                                                                                                                     |
| Outside press, View tasks              | Closes. View tasks navigates in the SPA to the filtered list.                                                                                                                                                                 |

Touch devices never get hover opens (Base UI ignores `openOnHover` for touch). Avatar-only triggers keep their 22 px visual size and get a 44 px hit area on coarse pointers without shifting layout.

Actions: **View tasks** only. There is no "Assign to me" or "Assign to this person" in the popover: every surface where assignment applies already places the assignee picker next to the person, so a second assignment path would duplicate it with different permission and version handling.

## Surfaces

Inventory at `origin/main` 7b8c62d, updated after the mobile branch (UB-40) and UB-76 activity landed. Phase A shipped #1–#2; Phase B wires every surface whose files are free. #3, #5 and #6 wait for components other tickets are changing, listed under _Remaining_.

| #   | Surface                                     | Location                                                                           | How the person opens                                                                                                                                                                                                                                                               | Status                        |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | Task properties — Assignee selected value   | `src/features/issue-properties/ui.tsx`                                             | The avatar beside the Assignee picker becomes a `PersonChip`; the picker stays the value editor. Shared by the task page and the new-task page.                                                                                                                                    | A, done                       |
| 2   | People settings — Identity review profiles  | `src/pages/settings/identity-review.tsx`                                           | Each conflict profile's avatar and name form one `PersonChip` (visible text stays the profile's own name; the card shows its canonical person).                                                                                                                                    | A, done                       |
| 3   | List rows — assignee avatar (UB-43 control) | `src/features/issue-edit/assignee.tsx`, rendered from `src/pages/issues/ui.tsx`    | The avatar still opens the assignee picker. The picker gains a leading **View profile** action item (never a value; like UB-30's Create item) that closes the picker and opens the card anchored to the same avatar. Available to viewers, whose assignment options stay disabled. | waits for UB-30               |
| 4   | List rows — fallback avatar                 | `src/entities/issue/ui.tsx` (`IssueRow`)                                           | No app caller: the only `IssueRow` (the task list) always passes the assignee control, so the fallback renders only in Storybook. Nothing to wire.                                                                                                                                 | not a surface                 |
| 5   | Board cards — assignee avatar               | `src/entities/issue/ui.tsx` (`IssueCard`), `src/widgets/issue-board/ui.tsx`        | The card is a `<button>`, so a nested control is invalid. The card becomes a container with the open button and the assignee control as siblings; the control is the row's UB-43 assignee control with the same View profile action.                                               | waits for UB-30               |
| 6   | Task preview — "priority · assignee" text   | `src/entities/issue/ui.tsx` (`IssuePeek`) inside `src/shared/ui/press-preview.tsx` | The assignee name becomes a `PersonChip` (`display="text"`) passed in by the page. The card portals into the preview's layer.                                                                                                                                                      | waits for UB-38/UB-31 preview |
| 7   | Comments — author avatar and name           | `src/widgets/issue-details/ui.tsx`                                                 | Avatar and name form one `PersonChip` for the attributed author (see the ID rule under _Components_).                                                                                                                                                                              | B, done                       |
| 8   | Activity — actor name                       | `src/widgets/issue-details/activity-feed.tsx`                                      | The actor name is a `PersonChip` (`display="text"`); Linear automation without a person stays text.                                                                                                                                                                                | B, done                       |
| 9   | People settings — member list               | `src/pages/settings/ui.tsx`                                                        | The member's name is a `PersonChip` (`display="text"`) and keeps the name style; the larger avatar beside it stays decorative and the role picker is unchanged.                                                                                                                    | B, done                       |
| 10  | Projects list — lead avatar                 | `src/pages/planning/ui.tsx`                                                        | `PersonChip` (avatar).                                                                                                                                                                                                                                                             | B, done                       |
| 11  | Project page — Project lead selected value  | `src/pages/planning-document/ui.tsx`                                               | Avatar `PersonChip` beside the picker while a lead is set, as in #1. Cycles have no lead.                                                                                                                                                                                          | B, done                       |
| 12  | Initiative page — Owner selected value      | `src/pages/knowledge/ui.tsx`                                                       | Avatar `PersonChip` beside the Owner picker while an owner is set; the two wrap together (`.knowledge-person`).                                                                                                                                                                    | B, done                       |
| 13  | Sidebar — signed-in profile                 | `src/widgets/navigation/ui.tsx`                                                    | Avatar and name form one `PersonChip` (the card's Membership line ends in "· You"). On a phone, View tasks also closes the navigation drawer.                                                                                                                                      | B, done                       |

Not surfaces: options inside a picker listbox (`src/shared/ui/select.tsx:61-66`, UB-30 `combobox.tsx`) are selection targets; a button nested in an option is invalid ARIA, and the selected value is covered by #1, #11 and #12. Mentions: the app renders no mention syntax today (`mention` has no hits under `src/`), so there is nothing to wire until mentions exist.

## Remaining

Both steps are blocked on other tickets' unmerged work, not on design:

- **#6 task preview** — `src/shared/ui/press-preview.tsx` is being rewritten for UB-38/UB-31. Today the preview closes on any outside `pointerdown` and on Escape, so a press inside a portalled person card closes the preview and View tasks is lost, and the card (`.popover-positioner`, z-index 120) sits under the preview (`.peek-surface`, 180). The agreed contract with that rewrite: `shared/ui` exports `usePreviewLayer()` (the preview's portal layer, `null` outside a preview); `PersonPopover` portals into it, where `.peek-layer .popover-positioner` stacks above the preview and presses count as inside; the preview's Escape skips while a nested `[data-popup-open]` trigger is inside it, so Escape closes the card first; the preview closes on route change. After it merges: portal the card into the layer and pass `PersonChip display="text"` into `IssuePeek` through a slot from the list page and the board.
- **#3 list rows and #5 board cards** — need UB-30's `Combobox` `actions` slot (committed on the UB-30 branch, not yet on `main`). After it merges: `IssueAssignee` passes `actions={[{ label: 'View profile', onSelect }]}` while a person is assigned; `PersonPopover` gains a controlled mode anchored to the row avatar (`Popover.Root open` + `Positioner anchor`, focus returning to the combobox trigger); the board card becomes a container with the open button and `IssueAssignee` as siblings.

## Decisions and rejected alternatives

- **Base UI `Popover` with `openOnHover`, not `PreviewCard`.** `PreviewCard` renders a link trigger: Enter follows the link instead of opening, taps navigate, and its popup is a supplementary preview rather than a reachable dialog. The person card has an action and must open with Enter/Space and on touch.
- **Focus opens without moving focus.** Moving focus on a focus-open would trap Tab traversal on every avatar. Opening in place keeps Tab order: the card is next in sequence while open.
- **Row avatar: View profile action in the assignee picker**, rejected alternatives: (a) hover card on the row avatar — two popups on one control, and unreachable by keyboard or touch; (b) a second avatar button — changes the dense row geometry and duplicates the person; (c) a header button above the search field — reachable only by Tab inside a popup whose keyboard model is arrow keys.
- **Connected `PersonChip` in `entities/workspace`, not a new `entities/person` slice.** The catalog and `me` queries live in `entities/workspace`; a separate slice could not import them (cross-slice import) and would duplicate the hooks.
- **No email redaction in the client** — see _Email permission_.
- **No links to Slack/Linear profiles.** The catalog has no Slack team ID or Linear workspace URL key, so any profile URL would be invented. The card names the linked providers instead.

## Acceptance mapped to tests

| Criterion | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Storybook `Design system/Person popover`: hover opens after the delay, keyboard focus opens without moving focus, touch tap opens, the `text` shape has no avatar. Surfaces: `tests/e2e/person-popover.spec.ts` opens the card from #1, #2 and #7–#13 (comments and activity including an imported author/actor and Linear automation, People list, projects list, project lead, initiative owner, desktop sidebar and the phone drawer). |
| 2         | `tests/unit/person-profile.test.ts`: canonical name/avatar across aliases, membership and bot/non-member labels, accounts, needs-review flag, email withheld without a known viewer. Stories render every field with axe.                                                                                                                                                                                                                 |
| 3         | Unit: `tasks_href` uses the canonical ID. Stories: View tasks is a link to it, closes the card and runs `onViewTasks`. E2E: the list shows the person's filter; on a phone View tasks from the drawer also closes the drawer.                                                                                                                                                                                                             |
| 4         | Remaining (#3, #5): row avatar still opens the assignee picker; View profile opens the card; a viewer can open it but cannot assign.                                                                                                                                                                                                                                                                                                      |
| 5         | Stories: Enter and Space open and focus the first control, Escape closes and restores focus, accessible names; unit: permission rule.                                                                                                                                                                                                                                                                                                     |
| 6         | Phase B screenshots at 1440×900, 390×844 in Chromium and WebKit, and 320 px width, read back and passed through `review visual`.                                                                                                                                                                                                                                                                                                          |

## Out of scope

- Server-side email redaction by role (see _Email permission_).
- Editing identity (merge/split/alias decisions) from the card; UB-29 keeps that read-only.
- Presence, local time, team membership lists or activity summaries in the card.
- Mentions, until a mention syntax exists.
