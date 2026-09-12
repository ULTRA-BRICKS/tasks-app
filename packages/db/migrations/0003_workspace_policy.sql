CREATE TABLE workspace_policies (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  allowed_email_domains TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL CHECK(version >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id, updated_by) REFERENCES memberships(workspace_id, user_id)
);
