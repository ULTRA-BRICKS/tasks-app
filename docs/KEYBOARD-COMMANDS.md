# Keyboard commands, selection and undo/redo

Refs UB-36. Status: phase A (pure model and isolated UI) on
`feat/keyboard-registry-UB36-20260929`; phase B (wiring) is not started.

## Goal

One command registry drives keyboard dispatch, context menus, the ⌘K / Ctrl K
palette, the ⌘/ / Ctrl / help with visible keycaps, and per-device remapping.
Escape dismisses one layer at a time. Shift-click and Shift+J/K select ranges.
Undo/Redo reverts saved task changes without touching native text undo and
never overwrites a newer conflicting server version.

## Acceptance criteria → tests

| #   | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase | Test                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| A1  | A binding string parses to one canonical form. Invalid, ambiguous (`Shift+/`) and over-long sequences are rejected.                                                                                                                                                                                                                                                                                                                                                                               | A     | `tests/unit/keyboard-commands.test.ts` "parse"           |
| A2  | Keyboard events normalize to one combo. `Mod` is ⌘ on Mac and Ctrl elsewhere. Mac Ctrl, Windows/Linux Meta and AltGr (Ctrl+Alt) never match. Option or a non-Latin layout falls back to the physical key. IME composition (`isComposing`, `Process`, keyCode 229) and modifier-only presses never match.                                                                                                                                                                                          | A     | "events"                                                 |
| A3  | Inside text entry, only modifier bindings of commands marked `allowInTextEntry` fire. Plain keys never steal typing, and `Mod+Z` stays native text undo.                                                                                                                                                                                                                                                                                                                                          | A     | "text entry"                                             |
| A4  | Two-step sequences (`G I`) resolve within 1 s. An unknown second key falls through to its own binding.                                                                                                                                                                                                                                                                                                                                                                                            | A     | "sequences"                                              |
| A5  | Conflict detection covers equal bindings and prefix overlaps (`G` vs `G I`). Browser/OS reserved combos are rejected with a reason on each platform. The default catalog has no conflicts or reserved keys on either platform.                                                                                                                                                                                                                                                                    | A     | "conflicts", "reserved", "catalog"                       |
| A6  | Keycaps: ⌘ ⌥ ⇧ on Mac, Ctrl Alt Shift elsewhere, plus a spoken label for assistive technology.                                                                                                                                                                                                                                                                                                                                                                                                    | A     | unit "display" + story `Design system/Keycaps`           |
| A7  | Commands that need edit rights are unavailable to viewers and to a missing role.                                                                                                                                                                                                                                                                                                                                                                                                                  | A     | "permissions"                                            |
| A8  | Escape resolves exactly one layer, in this order: IME composition → topmost surface → active text edit (the field keeps its draft) → selection → page context → nothing.                                                                                                                                                                                                                                                                                                                          | A     | "escape"                                                 |
| A9  | Remapping is stored per device in the Zustand preferences store (`tickets-ui`, version 1). A version 0 blob migrates. Unknown commands, fixed commands, malformed, reserved and conflicting overrides are dropped on load; repeated keys collapse; other stored fields with unknown values fall back to defaults. Setting a binding that would evict another override changes nothing. An empty list removes the shortcut.                                                                        | A     | `tests/unit/keyboard-preferences.test.ts`                |
| A10 | Remap UI records one combo. It ignores IME and modifier-only presses, lets Tab move focus, and cancels on Escape (with any modifier held) or on leaving the recorder, without letting the Escape reach the dialog. It rejects reserved or conflicting combos with an announced reason, and saves, resets and removes bindings. Change and Remove keep their place (Remove disables when empty, Reset is appended last) and focus returns to Change after Reset or Remove. Alternatives read "or". | A     | story `Features/Keyboard shortcut settings` (play + axe) |
| A11 | Range selection is inclusive in visible order, forward and reverse. Extending again shrinks or grows from the same anchor and keeps selections made before the range. Hidden or filtered rows are never selected. Keyboard extension starts from the focused row.                                                                                                                                                                                                                                 | A     | `tests/unit/selection-range.test.ts`                     |
| A12 | Domain undo/redo records saved changes and clears redo on a new change. It rejects when the field was changed since (field-level compare; primitive arrays compare as sets), when the entity is missing, or for viewers. It patches with the current version, so the server's 409 remains authoritative. It is capped at 50 entries.                                                                                                                                                              | A     | `tests/unit/domain-history.test.ts`                      |
| B1  | `features/keyboard` dispatches from the registry, with user overrides passed in from `app`. The static help modal becomes a registry-generated ⌘/ sheet with keycaps.                                                                                                                                                                                                                                                                                                                             | B     | e2e `keyboard-commands.spec.ts`                          |
| B2  | Palette lists registry commands with their keycaps and disables unavailable ones. Context menu items show the same keycaps.                                                                                                                                                                                                                                                                                                                                                                       | B     | e2e + `action-menu.stories.tsx`                          |
| B3  | Esc layering in the app: hidden retained popups (`hidden`, zero client rects, closing transition) do not count as open surfaces. Focus returns to the invoking control. Unsaved drafts survive.                                                                                                                                                                                                                                                                                                   | B     | e2e                                                      |
| B4  | Shift-click and Shift+J/K on `/tasks` rows. Shift+click on row text does not produce a stray native text selection; plain text selection inside a task still works.                                                                                                                                                                                                                                                                                                                               | B     | e2e                                                      |
| B5  | ⌘Z/⇧⌘Z (Ctrl Z / Ctrl Y) undo and redo the last saved property change through the versioned PATCH. A conflict shows the current server value and keeps the history consistent.                                                                                                                                                                                                                                                                                                                    | B     | e2e with a concurrent write                              |
| B6  | Settings → Keyboard tab mounts the remap UI. Bindings survive a reload.                                                                                                                                                                                                                                                                                                                                                                                                                           | B     | e2e                                                      |

## Decisions

- **Registry in `shared/lib/commands.ts`, catalog in `shared/lib/command-catalog.ts`.**
  These are pure data and functions, so every layer can read them without cross-slice imports.
  Handlers are attached at dispatch time in `features/keyboard` (phase B) and
  never stored in the registry.
- **Canonical binding text** (`Mod+Alt+Shift+K`, sequences separated by a space)
  is both the storage format and the equality key. `Mod` rather than `Meta`/`Ctrl`
  lets one stored override work across the user's platforms. Rejected: storing
  `KeyboardEvent.code`, because it breaks shifted punctuation such as `?`.
- **Shift is implied by punctuation.** `?` matches Shift+/ on US layouts, and
  `Shift+/` is rejected as ambiguous. Letters and named keys keep an explicit
  Shift.
- **Physical-key fallback** is used only for letters and digits under Option/Alt/Mod,
  or when the layout yields a non-Latin letter. It never applies to punctuation, whose
  position differs by layout.
- **Text-entry rule** replaces per-command exceptions: only modifier bindings of
  `allowInTextEntry` commands fire in fields. Native text undo therefore keeps `Mod+Z`
  inside fields with no special case.
- **Remap records one combo.** Defaults may be sequences (`G I`). Rejected: a
  sequence recorder, whose timing is hard to make accessible.
- **Per-device persistence**, per AGENTS.md: UI preferences live in Zustand.
  Server sync of bindings is out of scope and needs a user decision.
- **Field-level undo conflicts.** A newer version that changed other fields
  does not block undo; one that changed the undone field does. Rejected: blocking
  on any version bump, which would make undo useless while live updates arrive.
- **Remap UI lives in `features/preferences`.** It shares the store without a
  cross-slice import. It stays unmounted until phase B because `pages/settings/ui.tsx`
  belongs to the in-flight mobile branch (UB-40).

## Out of scope

Server-synced bindings; recording sequence shortcuts; multi-entity (bulk) undo;
undo of create/delete/comment; bindings for board drag-and-drop.
