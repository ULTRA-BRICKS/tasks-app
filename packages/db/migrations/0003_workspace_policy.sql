-- Versioned workspace security policy. A missing row means the default policy
-- (empty allowlist: invitations may target any email domain). Rows are created
-- lazily on first write; the seed below covers workspaces that predate this migration.
CREATE TABLE workspace_policy (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  allowed_email_domains TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at TEXT
);
INSERT INTO workspace_policy(workspace_id, updated_at) SELECT id, created_at FROM workspaces;
-- Compatibility for in-progress parallel work that reads workspace_policies
-- (plural): keep the table present and permissive so its checks pass while
-- the canonical policy lives in workspace_policy (singular) above.
CREATE TABLE IF NOT EXISTS workspace_policies (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  allowed_email_domains TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT
);
