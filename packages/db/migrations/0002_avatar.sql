-- Optional identity metadata. External identity linking / avatar upload is a later module.
ALTER TABLE users ADD COLUMN avatar_url TEXT;
