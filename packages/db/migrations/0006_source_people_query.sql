-- A read-only, workspace-scoped people view for the Linear-compatible query adapter.
-- Imported identities are deliberately excluded from memberships and authentication.
ALTER TABLE source_people ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
CREATE VIEW workspace_people AS
SELECT u.id,m.workspace_id,u.name,u.email,u.avatar_url,u.created_at,m.role,0 AS imported
FROM users u JOIN memberships m ON m.user_id=u.id
UNION ALL
SELECT p.id,p.workspace_id,p.name,p.email,p.avatar_url,p.created_at,'source' AS role,1 AS imported
FROM source_people p;
