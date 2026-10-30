-- AlterTable
ALTER TABLE IF EXISTS "user_settings"
DROP COLUMN IF EXISTS "proxy_urls",
DROP COLUMN IF EXISTS "febbox_key",
DROP COLUMN IF EXISTS "debrid_token",
DROP COLUMN IF EXISTS "debrid_service",
DROP COLUMN IF EXISTS "tidb_key",
DROP COLUMN IF EXISTS "disabled_sources",
DROP COLUMN IF EXISTS "embed_order",
DROP COLUMN IF EXISTS "enable_embed_order",
DROP COLUMN IF EXISTS "disabled_embeds",
DROP COLUMN IF EXISTS "manual_source_selection",
DROP COLUMN IF EXISTS "enable_double_click_to_seek",
DROP COLUMN IF EXISTS "enable_auto_resume_on_playback_error";
