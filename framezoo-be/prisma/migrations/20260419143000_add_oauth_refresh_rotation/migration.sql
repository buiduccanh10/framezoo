ALTER TABLE "sessions"
ADD COLUMN "refresh_jti" UUID,
ADD COLUMN "refresh_expires_at" TIMESTAMPTZ(0);
