-- Password-reset proofs are hashed; queued secret links are encrypted with the server key.
CREATE TABLE password_reset_tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  password_fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reset_tokens_user ON password_reset_tokens(user_id, expires_at);
CREATE TABLE account_email_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('password_reset','password_changed','invitation')),
  user_id TEXT REFERENCES users(id),
  workspace_id TEXT REFERENCES workspaces(id),
  reset_hash TEXT REFERENCES password_reset_tokens(hash),
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  lease_until TEXT,
  expires_at TEXT NOT NULL,
  provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX account_email_pending ON account_email_jobs(status, available_at);
