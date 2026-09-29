# Task activity shows what changed

User report, 29 September 2026 (UB-76 / 27b3f56d-de08-4912-a031-3dfdfbb36461): the task Activity lists only "Alex updated the issue" entries, so nobody can see which status, assignee, dates or description text changed. Activity is the task's audit trail; each update must name its fields with old → new values.

## What the stored history already contains (no migration)

- Native `updated` rows have stored `{ field: { from, to } }` for every editable field since the first tickets commit (d9771a6): `title`, `description` (full text before and after), `kind`, `status_id`, `priority`, `assignee_id`, `project_id`, `cycle_id`, `milestone_id`, `parent_id`, `estimate`, `start_date`, `due_date`, `position`, the `archived`/`deleted` flags, and `label_ids` as `{ from: [...], to: [...] }`. Linear team moves add `team_id` and `key`. The old presentation discarded all of it and printed a fixed verb, so **every existing native update is derivable** from the current `activity.data` column.
- Imported Linear history (`linear_imported_change`) stores Linear's from/to IDs for fields and labels. Linear records a description edit only as `updatedDescription: true`; its text is not in the history API, so **imported description diffs are not derivable**. They show "Description edited (Linear history does not include the text)", never a fake diff.
- Capture going forward needs no change: the writer already stores full before/after values. No production migration, re-import or audit rewrite is involved; the `activity` rows stay byte-identical.

## API contract

`GET /api/v1/issues/:id` activity rows keep `id`, `action`, `data` (immutable audit payload), `actor_name`, `created_at`, and gain:

- `summary`: the event verb without the actor: `updated the task`, `created the task`, `added a comment`, `archived the task`, `moved the task to trash`, `created the task in Linear`, …
- `changes`: ordered structured field changes:
  - `{ kind: 'value', field, label, from, to }` for status, assignee, priority, title, type, team, ID, project, milestone, cycle, parent task, estimate, start date and due date. `from`/`to` are display text: referenced records resolve to their names in the same workspace, cleared values to a readable empty label (`Unassigned`, `No due date`, …), missing records to `Unavailable …`, never a raw UUID.
  - `{ kind: 'labels', field: 'labels', label: 'Labels', added, removed }` with every label name (arrays carry names only, never a count placeholder); an unchanged label set yields nothing. Name lookups are batched per table, not capped, so a resolvable record never reads as unavailable.
  - `{ kind: 'text', field: 'description', label: 'Description', from, to }`: full Markdown before/after for native edits; both `null` when the source did not record text (imported Linear).
- `details`: extra non-field notes (`reordered the task`, `updated task links: SRC-8`, `updated attachment: …`, a second imported verb such as `moved the task to trash`).

People (assignee values and imported Linear users) use the canonical person projection shared with the rest of the detail response; unknown or former members fall back to their stored account/source name, then `Unavailable person`. Imported references still resolve against the matching immutable import records (see IMPORTED-HISTORY.md). Unknown payload keys and action codes are never shown.

## Presentation

- An entry reads `<Actor> <summary>` with its time, followed by one row per change: `Status  Todo → Done`, `Labels  added Bug; removed Backend`. Values wrap; long titles break rather than widen the page.
- Description rows use a native `<details>`/`<summary>` disclosure (`View changes` / `Hide changes`): keyboard, focus and expanded state come from the platform, and the diff is computed only when opened. The diff is line-based with word-level highlighting inside replaced lines; removals use `<del>` and additions `<ins>`, each changed line prefixed by visually hidden "Removed:"/"Added:" text so screen readers announce it, and colour is never the only cue (−/+ gutter signs, strike-through/underline). Unchanged runs keep two lines of context and collapse the rest into "N unchanged lines". When the two versions total more than 4,000 lines (a pasted document would otherwise render one row per line) or the changed region needs more than a million line comparisons, the complete before and after texts are shown instead of a diff.
- Grouping: consecutive update events (native `updated` or imported field changes) by the same actor, each within 10 minutes of the previous one, merge into one entry with every change row in chronological order. Nothing is collapsed or deduplicated, so every individual field change stays inspectable. Created, commented, archived, trashed and restored events break a group; a native archive/unarchive (stored as an `updated` row with a bare `archived` flag) therefore gets the `archived the task` / `restored the task from the archive` summary rather than a detail line, matching imported history. The panel keeps showing the latest eight entries.
- Wording says Task, never Issue.
- Permissions: activity is part of the task detail, which already requires workspace `read`; every name lookup is scoped to the viewer's workspace, so no value from another workspace can appear. There are no per-field visibility rules for workspace readers.
- Phone (390×844, 320 px): rows stack label above value when narrow; the diff scrolls inside its own box; the page never overflows horizontally.

## Decisions and rejected alternatives

- Structured `changes` computed on the server, not by the browser parsing `data`: one presentation for native and imported history, and clients never depend on storage keys.
- Diff in the browser from the provided before/after text, not a server-side diff: the texts are already in the response; no second endpoint or dependency. Rejected: lazy per-event diff endpoint (more routes for data already sent); third-party diff package (a small bounded LCS covers Markdown descriptions).
- Grouping on the client over the returned events: the API keeps one row per audit record.
- Rejected: collapsing repeated edits of one field inside a group into net old → new (hides intermediate values, violating "every change inspectable").

## Acceptance → tests

| Criterion                                                                                                                                   | Test                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Native events map to old → new for every field type, labels added/removed, description before/after, legacy rows, unknown keys hidden       | `tests/unit/activity-changes.test.mjs` (HTTP: real updates then `GET /api/v1/issues/:id`) |
| Imported Linear history presents the same `changes` shape; description marked as not recorded                                               | `tests/unit/activity-presentation.test.mjs`                                               |
| Grouping window/actor/verb rules and the line/word diff                                                                                     | `tests/unit/activity-view.test.ts`                                                        |
| Browser: change status + assignee + description, then see precise rows and expand the diff with the keyboard; phone layout without overflow | `tests/e2e/task-activity.spec.ts` (Chromium + WebKit)                                     |
| Imported history on desktop/mobile                                                                                                          | `tests/e2e/imported-history.spec.ts`                                                      |

Out of scope: activity pagination beyond the existing 200-event query, comment edit diffs, and description history for imported Linear rows (the source has no text).
