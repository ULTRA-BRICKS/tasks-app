# Visible action menus — release scope, 18 September 2026

This change completes a bounded subset of the requested context actions: shared overflow menus with nested commands. It does not claim universal right-click support or the full keyboard-contract release.

## Included

Teams and saved views have a visible trailing action button. Team actions open its issue list, create an issue draft in that team and copy team information. Saved views can be opened, copied or deleted with explicit confirmation and server authorization; deleting a view does not delete its issues.

Document/initiative rows have Open, nested Copy, and permission-aware Archive/Restore. Archive uses the row's expected version and requires confirmation. Detail pages expose Copy to readers as well as writers; mutations stay disabled for viewers and while a local edit is pending. Issue details get a Copy submenu that uses the current title/body draft rather than silently copying the previous saved text.

Copy formats: link, identifier, title, Markdown, linked title, issue branch name and task prompt. Historical Markdown/Unicode remains literal; linked-title brackets are escaped; generated branch names exclude unsafe ref punctuation. The copying action executes in the original user event. Async failures produce a dismissible alert instead of a silent success claim. Menu actions are single-flight while pending.

## Verification boundary

Three pure copy-format tests and eight focused Chromium/WebKit scenarios passed before the final release gate. Scenarios cover team-ID copying, submenu keyboard navigation, one-level Escape, restored trigger focus, cancel-without-write and clipboard-denial feedback. Storybook adds nested-menu and failure-feedback interaction tests.

The four new right-click/Shift+F10 contract tests remain separate RED acceptance cases. The proposed custom context boundary and conversion of existing PressPreview routing were rejected by the tool before writing. Those implementations are absent, and this release does not describe those cases as passing. Existing PressPreview/right-click behavior was not changed. Full Team deletion/rename, global shortcut configuration, saved-entity Undo/Redo, invitations and expanded command-search work are separate pending scopes.

## References and data

The private Linear screenshots remain outside Git in `/ultra/Tasks UI references/`. This menu increment preserves the current dark visual language, adds compact nested surfaces and maintains 44px touch action targets. Full same-state Linear pixel parity is not certified by the component regression screenshots.

No production content import, database schema change, owner change, token write or email operation is part of this release. Other active worktrees are untouched. Candidate source, final checks and deployed revision must be recorded before publication is claimed.

## Follow-up validation

The first new Storybook submenu case exposed a test-readiness race: an item exists before its opening transition makes it visible. Replaced the immediate assertion with an observable visibility wait; no timeout extension or sleep. Removed unsupported Testing Library `exact` options (string names already match exactly). Final source/types/build passed186unit tests, and normal Storybook passed20/20 including both added cases.

The actual captured desktop menus were too rounded/tall compared with the supplied19.45.25 desktop reference. Fine-pointer menus now use existing12px popup/6px item radii,32px rows and13px text. Coarse-pointer menus retain44px targets. This is an explicit reference-led correction using existing tokens, not a claimed full pixel match.

The initial three-role review became idle and was terminated after more than seven minutes without a finalized report; it is NOT an approval. A new ordinary review must cover the final staged source before merge.

## Completed review findings and response

The default reviewer pool completed correctness, quality and security; the unavailable Codex seat reported its usage limit and was handled by normal reserve selection. The claimed missing `me` variable is a diff-only false positive: the pre-existing `const { data: me } = useMe();` is at KnowledgeListPage line28, before any conditional return. Both the full-source typecheck and the real document-row tests confirm it. No duplicate identity hook was added.

Addressed the actionable maintainability findings: the private action-controller hook returns state/callbacks rather than JSX; the root always renders its error notice. Known permission/version errors receive explicit safe messages; raw errors are not logged because they can contain private content. All popup geometry now lives in one base/coarse-pointer section with existing tokens. Archive transport is shared by list and editor while each retains its own lifecycle/dirty-state guard. The recursive item flag is now clearly named disabled, and copy formatting is named buildCopyValues.

Existing role guards and per-row navigation wrappers deliberately remain local to this bounded release; broad application policy refactoring is not required for menu safety. Final browser checks must use the staged candidate tests; the untracked right-click acceptance remains explicitly outside this incomplete scope rather than being disabled or reported green.
