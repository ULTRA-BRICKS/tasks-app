-- Ongoing one-way Linear -> Tasks live sync (additive to the completed one-time import).
ALTER TABLE linear_source_map ADD COLUMN local_snapshot TEXT;
ALTER TABLE linear_source_map ADD COLUMN source_deleted_at TEXT;
ALTER TABLE linear_source_map ADD COLUMN synced_at TEXT;

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

-- Checkpoint for the changed-issues/comments catch-up backstop (and future no-webhook metadata polling).
CREATE TABLE linear_sync_cursors (
  workspace_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  cursor TEXT,
  last_synced_at TEXT,
  status TEXT,
  PRIMARY KEY(workspace_id,source_workspace_id,collection)
);
