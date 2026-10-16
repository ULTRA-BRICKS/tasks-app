# Linear comment identity reconciliation

A historical raw-source-UUID comment can coexist with the later namespaced imported comment. Equal text alone is not proof of duplication. This maintenance operation verifies source mappings, immutable import payloads, issue identity, creation time, author evidence, current content, and pending native export work before proposing a repair.

## Prevention

Bulk import and append refuse a new comment whose raw source UUID already exists in the same workspace without the appropriate canonical source binding. The response is `409 COMMENT_SOURCE_BINDING_REQUIRED`; no destination comment is created. Both planning and apply check this condition. Already mapped replay remains idempotent, and foreign-workspace IDs neither block the import nor appear in the response.

The existing `/api/v1/imports/linear/bind` workflow supports explicit targets after the source organization has a completed import. It is a recovery path for append collisions, not a shortcut around a blocked first bulk import. A first-import collision requires an operator-reviewed import/reconciliation plan. Never delete or merge records merely to bypass this refusal.

## Required schema migration

Production requires migration **0009_history_workspace_id.sql** before this repair is released or run. It adds nonunique `activity(workspace_id,id)` and `outbox(workspace_id,id)` indexes; the existing activity workspace/issue/time index does not provide workspace/id keyset access. This production migration has **not been applied** by this work. The coordinator/operator must approve and execute it through the normal migration process. The repair command never migrates, and readiness continues to require the exact current schema version.

## Read-only preview

Use the reviewed source and an authorized database-operator connection. Supply the connection URL in a protected environment variable, not in command arguments, terminal output, or a committed file. The selected actor must have an actual administrator membership in the target workspace. The command does not authenticate a password and does not manufacture membership.

```sh
bun scripts/reconcile-linear-comments.mjs \
  --postgres-env REPAIR_DATABASE_URL \
  --workspace WORKSPACE_UUID --actor ADMIN_USER_UUID \
  --source LINEAR_ORGANIZATION_UUID \
  --comment SOURCE_COMMENT_UUID
```

Repeat `--comment` for up to fifty distinct source UUIDs. For a local SQLite database, substitute `--sqlite /absolute/path/to/existing.sqlite` for `--postgres-env`. The two connection modes are mutually exclusive. There is no implicit database fallback, migration, schema initialization, or force option.

Preview is read-only and returns a `plan_hash`, proven `pairs`, unresolved `ambiguous` cases, and predicted counts. Preserve the report securely. Content or provenance disagreements remain unresolved; both records are retained. Foreign and missing IDs are indistinguishable.

## Explicit audited apply

After the operator approves the exact preview, repeat the same arguments with `--apply-plan EXACT_PLAN_HASH`. Apply runs transactionally (READ COMMITTED on PostgreSQL), rechecks the evidence, retains the canonical comment, and archives the removed legacy row and its current version together with provenance and historical references in the completed `linear_imports` receipt. Existing audit/outbox/source-map records remain unchanged; an additional audit event links the repair to its receipt.

The PostgreSQL operator explicitly selects READ COMMITTED before statements, acquires the workspace transaction advisory lock before reading membership or evidence, and holds it through final version-checked deletion, audit and receipt commit. Bind/append apply, bulk-import native writes, and live-sync job fences use the same `pg_advisory_xact_lock(hashtext(workspace_id))` contract. Each statement after a lock wait sees the preceding writer's committed state. Merely moving the lock earlier under SERIALIZABLE or REPEATABLE READ is insufficient: the advisory-lock SELECT itself can establish a snapshot before waiting. Direct apply rejects those higher isolation levels; callers must also resolve authorization under the workspace lock. Read-only operator preview retains REPEATABLE READ.

A stale plan or transaction failure refuses the operation. Preview again instead of forcing it. On an uncertain connection outcome, inspect the receipt or retry the original hash: a completed receipt returns the same result without another deletion. Do not create a new plan blindly after losing the response.

The archive preserves the version that actually existed. It cannot reconstruct earlier versions absent from the database. Historical references are resolvable through the receipt; no public comment-alias API is introduced. Restoring an archived row is a separate operator-reviewed operation.

## Conservative evidence limits

Creation timestamps with more than millisecond precision must have identical stored representations. Differing high-precision strings remain unresolved rather than being rounded to the same JavaScript timestamp. Equivalent timestamps within millisecond precision retain the ordinary comparison behavior. This may require manual review of differently formatted high-precision values, but cannot turn lost precision into deletion evidence.

Reference discovery admits at most 100,000 total workspace rows across activity and outbox, using bounded indexed key counts (at most 100,001 keys per table). It streams stable workspace/id keyset pages, independent of the number of candidates. Each page considers at most 1,024 rows and fetches only the prefix whose stored fields total at most 8,000,000 bytes. This is a per-page limit, not a whole-history byte limit. A single oversized row, an empty page before the expected count, or excess visited rows refuses the operation; evidence is never silently skipped. Only the current page and capped candidate archives are retained. Comment rows (at most 100 IDs), issue source mappings (50 IDs), source people (50 IDs), and native authors (100 IDs) are read in exact-key batches, alongside the existing source/reverse mapping batches. More than 1,000 reverse source bindings also refuses the operation. Individual candidates exceeding 1,000 references per history table or the 2 MB archive budget remain unresolved; their evidence is never silently truncated and accepted. Pending, processing, failed and blocked native export jobs prevent deletion because they can still run or retry. Terminal history is retained in the archive.

## Verification

Synthetic SQLite and PostgreSQL tests cover no-effect preview, stale evidence, author/content disagreement, distinct legitimate repeats, atomic rollback, replay receipts, workspace privacy, and signed import/webhook create/update/removal replay. The operator tests also exercise real PostgreSQL transaction modes and credential-safe failures. Production cleanup must be separately previewed and approved; passing synthetic tests is not proof that production records were modified.

## Release corrections

Migration 9 adds three nonunique indexes: ordered workspace/history indexes on
activity and outbox, plus `comments(workspace_id, lower(id))` for canonical UUID
collision checks. Production schema changes and data repair require explicit
operator approval; they have not been applied by preparing this source.

The per-candidate 2 MB archive budget measures the exact persisted archive,
including source mapping and complete provenance payload. Paging also limits
candidate sizing work to four times the admitted row count per history table.
Dense oversized history refuses the whole operation rather than repeatedly
sizing a long unfetched tail or accepting incomplete evidence. No force or
truncation option bypasses these limits.
