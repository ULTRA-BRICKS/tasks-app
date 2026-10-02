-- Source ownership is attribution, never a new login or membership.
ALTER TABLE saved_views ADD COLUMN owner_source_id TEXT REFERENCES source_people(id);
ALTER TABLE saved_views ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE saved_views ADD COLUMN updated_at TEXT;
ALTER TABLE saved_views ADD COLUMN archived_at TEXT;
CREATE TABLE favorites (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), owner_id TEXT, owner_source_id TEXT REFERENCES source_people(id), target_type TEXT NOT NULL CHECK(target_type IN ('issue','project','document','initiative','cycle','customView','label','team')), target_id TEXT NOT NULL, sort_order REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, CHECK(owner_id IS NOT NULL OR owner_source_id IS NOT NULL), FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,user_id), UNIQUE(workspace_id,owner_id,target_type,target_id));
CREATE INDEX favorites_owner ON favorites(workspace_id,owner_id,sort_order,id);
