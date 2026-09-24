CREATE TABLE mcp_oauth_codes (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX mcp_oauth_codes_expiry ON mcp_oauth_codes(expires_at);
CREATE TABLE mcp_oauth_grants (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL UNIQUE REFERENCES api_tokens(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

CREATE TABLE mcp_oauth_refresh_history (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX mcp_oauth_refresh_family ON mcp_oauth_refresh_history(grant_id);
