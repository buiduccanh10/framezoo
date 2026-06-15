-- Set default theme for new settings rows
ALTER TABLE "user_settings"
ALTER COLUMN "application_theme" SET DEFAULT 'ember';

-- Backfill existing NULL themes (optional but helpful)
UPDATE "user_settings"
SET "application_theme" = 'ember'
WHERE "application_theme" IS NULL;

