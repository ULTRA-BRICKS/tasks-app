-- Ongoing one-way Linear -> Tasks live sync (additive to the completed one-time import).
ALTER TABLE linear_source_map ADD COLUMN local_snapshot TEXT;
ALTER TABLE linear_source_map ADD COLUMN source_deleted_at TEXT;
ALTER TABLE linear_source_map ADD COLUMN synced_at TEXT;
-- Canonical source updatedAt of the payload actually applied. Used to reject a delivery
-- whose canonical updatedAt is not newer than what's already applied (finding: stale
-- delivery must be a zero-write no-op).
ALTER TABLE linear_source_map ADD COLUMN source_updated_at TEXT;
-- source_deleted_at holds the REMOVE event's own occurrence time (body.createdAt), not
-- the time we processed it -- chronology comparisons (stale remove, stale update-after-
-- remove, implicit restore) all key off this value directly. last_removed_at is a
-- historical marker: set whenever a remove is ever applied, NEVER cleared by a restore,
-- so "was this ever removed, and when" stays inspectable even after restored_at clears
-- the ACTIVE marker (source_deleted_at) back to NULL.
ALTER TABLE linear_source_map ADD COLUMN last_removed_at TEXT;
ALTER TABLE linear_source_map ADD COLUMN restored_at TEXT;

-- Durable, inspectable proof that a signed remove was received and processed for a
-- source id that was NEVER imported/mapped -- linear_source_map.target_id is NOT NULL
-- (migration 0005), so an unmapped remove cannot use that table; this is additive so we
-- never fabricate a native row just to have somewhere to record the receipt.
CREATE TABLE linear_removal_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  source_id TEXT NOT NULL,
  removed_at TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,source_workspace_id,collection,source_id)
);

-- Live hydrated payload cache, distinct from the frozen linear_import_records snapshot.
CREATE TABLE linear_sync_records (
  workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,source_workspace_id,collection,source_id)
);

CREATE TABLE linear_webhook_inbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  organization_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  webhook_timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed','blocked','unsupported')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  claim_token TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,delivery_id)
);
CREATE INDEX linear_inbox_pending ON linear_webhook_inbox(status,next_attempt_at);

-- A different body for an already-seen delivery_id: never silently accepted/overwritten.
CREATE TABLE linear_webhook_inbox_mismatches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- field='__source_removed__' marks a DELETION conflict (local content had diverged from
-- the frozen/source baseline at the moment a verified remove arrived): remote_value holds
-- the remove event's occurrence timestamp for provenance. 'acknowledged' is the only valid
-- resolution for that field (see service.mjs) -- there is no "remote value" to apply for a
-- deletion, and native content is never erased regardless of resolution.
CREATE TABLE linear_sync_conflicts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  field TEXT NOT NULL,
  baseline_value TEXT,
  local_value TEXT,
  remote_value TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK(resolution IN ('kept_local','applied_remote','acknowledged'))
);
CREATE INDEX linear_sync_conflicts_open ON linear_sync_conflicts(workspace_id,resolved_at);

-- Checkpoint for the changed-issues/comments catch-up backstop (and future no-webhook metadata polling).
-- pass_since/pass_until bound a SINGLE catch-up pass and never change mid-pass; last_synced_at (the
-- watermark used as the lower bound for the NEXT pass) only advances once that pass's FINAL page
-- commits. version is an optimistic-concurrency guard against two concurrent checkpoint writers.
CREATE TABLE linear_sync_cursors (
  workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  cursor TEXT,
  last_synced_at TEXT,
  pass_since TEXT,
  pass_until TEXT,
  status TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,source_workspace_id,collection)
);
