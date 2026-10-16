-- Workspace history admission and ordered keyset pages must not scan foreign history.
CREATE INDEX activity_workspace_id ON activity(workspace_id,id);
CREATE INDEX outbox_workspace_id ON outbox(workspace_id,id);

-- Canonical UUID collision detection must not scan every comment on each append.
CREATE INDEX comments_workspace_canonical_id ON comments(workspace_id,lower(id));
