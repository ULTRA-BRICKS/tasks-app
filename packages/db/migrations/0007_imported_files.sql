CREATE TABLE linear_import_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','source_unavailable')),
  sha256 TEXT,
  bytes INTEGER,
  mime TEXT,
  filename TEXT,
  object_key TEXT,
  source_status INTEGER,
  verified_at TEXT,
  UNIQUE(workspace_id,import_id,source_hash),
  FOREIGN KEY(workspace_id,import_id) REFERENCES linear_imports(workspace_id,id)
);
CREATE INDEX imported_files_workspace ON linear_import_files(workspace_id,import_id,status);
