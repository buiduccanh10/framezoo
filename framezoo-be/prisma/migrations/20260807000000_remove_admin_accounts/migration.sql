-- Remove legacy admin accounts and their user-scoped data.
DELETE FROM "bookmarks"
WHERE "user_id" IN (
  SELECT "id"
  FROM "users"
  WHERE "permissions" @> ARRAY['admin']::TEXT[]
);

DELETE FROM "progress_items"
WHERE "user_id" IN (
  SELECT "id"
  FROM "users"
  WHERE "permissions" @> ARRAY['admin']::TEXT[]
);

DELETE FROM "sessions"
WHERE "user" IN (
  SELECT "id"
  FROM "users"
  WHERE "permissions" @> ARRAY['admin']::TEXT[]
);

DELETE FROM "watch_history"
WHERE "user_id" IN (
  SELECT "id"
  FROM "users"
  WHERE "permissions" @> ARRAY['admin']::TEXT[]
);

DELETE FROM "user_settings"
WHERE "id" IN (
  SELECT "id"
  FROM "users"
  WHERE "permissions" @> ARRAY['admin']::TEXT[]
);

DELETE FROM "user_group_order"
WHERE "user_id" IN (
  SELECT "id"
  FROM "users"
  WHERE "permissions" @> ARRAY['admin']::TEXT[]
);

DELETE FROM "users"
WHERE "permissions" @> ARRAY['admin']::TEXT[];
