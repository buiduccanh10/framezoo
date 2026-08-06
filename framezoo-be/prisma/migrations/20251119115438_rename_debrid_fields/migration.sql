-- Safely add the new 'debrid_service' column if it doesn't exist yet
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "debrid_service" VARCHAR(255);

-- Conditionally update existing rows to set the default service to 'realdebrid'
-- only if the 'debrid_token' column actually exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_settings'
          AND column_name = 'debrid_token'
    ) THEN
        -- Use EXECUTE so the UPDATE is not parsed at compile time (avoids errors
        -- if the column is missing at parse time in some PostgreSQL versions)
        EXECUTE 'UPDATE "user_settings"
                 SET "debrid_service" = ''realdebrid''
                 WHERE "debrid_token" IS NOT NULL';
    END IF;
END $$;
