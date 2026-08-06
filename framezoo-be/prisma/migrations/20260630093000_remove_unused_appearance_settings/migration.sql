ALTER TABLE "user_settings"
DROP COLUMN IF EXISTS "enable_discover",
DROP COLUMN IF EXISTS "enable_featured",
DROP COLUMN IF EXISTS "enable_details_modal",
DROP COLUMN IF EXISTS "enable_image_logos",
DROP COLUMN IF EXISTS "enable_carousel_view",
DROP COLUMN IF EXISTS "force_compact_episode_view",
DROP COLUMN IF EXISTS "home_section_order",
DROP COLUMN IF EXISTS "enable_pause_overlay";
