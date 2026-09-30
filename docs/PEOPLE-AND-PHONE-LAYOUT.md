# People controls and phone layout — 25 September 2026

Tracked feedback: UB-27/UB-28/UB-29/UB-30. Full17-request register is UB-27 through UB-43, stored in Tasks rather than Forgejo issues or Linear. This increment starts from canonical-numbering main7d25a79 and must not modify/import/renumber existing tasks.

## Layout correction

A real browser fixture with a long assignee exposed a1736px document on a393px phone. The mobile property grid used auto-minimum1fr tracks, allowing the long control to determine track width. Tracks now use minmax(0,1fr); property children shrink and labels truncate within the control, remaining readable in the popup. A separate8px WebKit drift at320px came from html/body/root min-width320px plus the8px scrollbar; the root minimum is now0. Pinch zoom is not disabled and content is not masked with another overflow:hidden rule.

Chromium/WebKit cases cover320/393/430px with long names and unbroken URLs, deliberate horizontal scroll attempts and a start-date popup/input bounded by320px. This does not replace the date UX with the requested compact calendar; UB-38 remains separate. The later iPhone drift work (UB-32) removed the touch `body` clip and extends these cases to tables, code, focus, every popup and safe areas: see [PHONE-OVERFLOW.md](PHONE-OVERFLOW.md).

## People presentation and assignment

Unambiguous member/source records from different providers with the same normalized email share one display option; every original ID remains an alias in memory. Same-name records, missing emails, email plus aliases and ambiguous same-provider duplicates remain distinct. A known Slack source profile takes display-name/photo precedence. This is presentation grouping, not a database/account merge, access grant or historical-author rewrite. Explicit Slack bindings, bot separation, server-side names, alias-aware filters, the People review state and the read-only inventory are specified in [PEOPLE-IDENTITY.md](PEOPLE-IDENTITY.md) (UB-29), including the decision not to add a durable alias table.

Task assignee, project lead and initiative owner use the same display projection. Existing source IDs are mapped to the displayed option without a mutation on mount. Explicit user assignment uses the existing authenticated, version-checked API. List avatars are interactive named comboboxes. Read-only users can inspect disabled suggestions; mutation failure displays an error and preserves the previous assignment. The caller supplies the newest loaded source row, not the paced/stale presentation row. The task-list assignee filter now offers one option per person, and the server expands it to every alias (see PEOPLE-IDENTITY.md).

Avatar components accept returned HTTPS/same-origin image URLs and fall back to initials on error; they do not guess Slack URLs or leak referrers/tokens. Suggestions render those avatars. The current production inventory had no member/source avatar_url, and the Slack connector's textual profiles did not return image fields. Therefore this increment supplies correct rendering, not a claim that real Slack-photo synchronization is configured. UB-28 stays open.

## Verification boundaries

Old duplicate options, inert row avatars, width overflow and inability for a viewer to inspect the picker were observed failing before the corresponding fixes. Write/409 rollback, focus/Escape and no-navigation behavior have focused browser tests. Pure helper tests preserve source data and cover ambiguity. Final whole-suite/review/deployment receipts belong to the PR and WORK-CHECKPOINT.

Original screenshots and live identity inventory remain outside Git in private Library and ~/xp/.tasks-work-evidence/feedback-20260925/. Only synthetic fixtures belong in tests. No90%reference-parity claim follows from self-baseline screenshots, and no account/password/membership/source migration is part of this release.

The row controls receive the shared page directory rather than mounting their own catalog polling observers. This preserves one page-level query ownership instead of adding a background timer for every visible task.

## Review follow-up: shared identity projection

A real regression test demonstrated that repeated helpers rebuilt identical directories/options. The catalog now owns one weakly cached directory per immutable catalog reference, with one alias index and shared editable/read-only option arrays. Row rendering no longer maps the complete people list for each row, and lookup is constant-time after indexing. A new catalog identity rebuilds the projection; no global email-keyed cache crosses workspace boundaries.

The exported CanonicalPerson and PersonDirectory types describe the public TypeScript boundary. The existing pure JSDoc module stays in place; the attempted file-extension conversion was rejected before writing, and no alternate conversion was attempted. Runtime immutability and ambiguity tests remain unchanged. Read-only per-option disabling is deliberately retained: disabling the entire trigger would prevent the viewer inspection explicitly requested by the user.
