-- Ongoing one-way Linear -> Tasks sync. Additive only: no existing table is narrowed,
-- no user/membership/import table is touched. Reuses linear_source_map as the
-- source-id -> native-id mapping and linear_import_records as the immutable
-- baseline for entities already covered by the completed import.

-- local_snapshot: native field values as of the last sync write, for 3-way merge.
-- source_deleted_at: tombstone when Linear reports the source entity removed;
--   the native row and its content are never hard-deleted.
-- synced_at: observability only.
ALTER TABLE linear_source_map ADD COLUMN local_snapshot TEXT;
ALTER TABLE linear_source_map ADD COLUMN source_deleted_at TEXT;
ALTER TABLE linear_source_map ADD COLUMN synced_at TEXT;

-- Hydrated live source payloads, keyed like linear_source_map. Distinct from the
-- immutable linear_import_records table (never written to after the one-time
-- import): this is the live cache used for baseline bootstrap and for
-- readable-history name resolution of entities that did not exist at import time.
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

-- Transactional inbox for signed Linear webhooks. Durable before any 200 response;
-- delivery_id dedup mirrors webhook_deliveries but keeps Linear's own required
-- validation columns (organization/resource/action/timestamp) separate from the
-- GitHub/Slack worker's table and dispatch loop.
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
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,delivery_id)
);
CREATE INDEX linear_inbox_pending ON linear_webhook_inbox(status,next_attempt_at);

-- A different body for an already-seen delivery_id is never silently accepted or
-- overwritten; it is recorded here for admin inspection and the original row is untouched.
CREATE TABLE linear_webhook_inbox_mismatches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per field where the same sync pass found both a local and a remote
-- change since the last synced baseline, with different resulting values.
-- Local content is always preserved; this is the inspectable, resolvable record.
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
  resolution TEXT CHECK(resolution IN ('kept_local','applied_remote'))
);
CREATE INDEX linear_sync_conflicts_open ON linear_sync_conflicts(workspace_id,resolved_at);

-- Pagination checkpoints for collections with no webhook coverage (teams,
-- workflow states, project milestones) and for the daily issues-since-checkpoint
-- reconciliation backstop. Cursor only advances after its chunk's write commits.
CREATE TABLE linear_sync_cursors (
  workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  cursor TEXT,
  last_synced_at TEXT,
  status TEXT,
  PRIMARY KEY(workspace_id,source_workspace_id,collection)
);
