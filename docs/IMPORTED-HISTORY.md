# Readable imported history

This patch changes presentation only. Existing `linear_imported_change` actions, original payloads, actors and timestamps remain in the database; no migration, re-import or audit rewrite is required.

The issue detail API now supplies `summary` and `details`. Imported state, assignee, priority, title, team, project, milestone, cycle, parent, estimate and due-date transitions are rendered as readable before/after values. Description edits, labels, attachments, relationships, archive and trash changes have explicit messages. Multiple changes in one event are retained. Explicit null means cleared; omitted properties may use legacy nested values. Both milestone objects and flattened legacy IDs are supported. Native comment-edit and unlink verbs are preserved.

Reference labels are resolved from the immutable records of the matching import in the same workspace, not today's renamed entities. Lookup uses the already-loaded Linear source link, validates the deterministic issue ID and queries collection-keyed indexes. It is bounded to 2,000 distinct references with one query per collection, without reverse source-map scans. Missing source entities receive a readable unavailable-value label rather than an internal UUID. Unknown events receive a neutral description instead of exposing an action code or guessing their meaning.

Linear's abbreviated relationship operation codes are not interpreted speculatively. The message lists the affected issue identifiers. An event with no source actor is attributed to Linear, not the account that performed the import and not an unverified claim about automation.

The browser renders the API's text as ordinary React text, preserving escaping and avoiding raw JSON/HTML. Multi-change events wrap on narrow screens. A fallback for an older API response never exposes the internal action code.

Tests cover already-imported records, immutable audit bytes, historical reference names after a local rename, missing source data, actor attribution, null/zero/boolean values, unsupported actions, and a real HTTP import followed by desktop/mobile browser reloads. The release stays on schema 7 and does not include the unfinished schema 8 navigation or task-cli branches.

Whole-source presentation verification on the imported snapshot: 5,393 events, 580 multi-change events, four neutral fallback events, and two unresolved historical references. The private verification receipt remains outside Git with the source snapshot. Production data is not modified by that check.
