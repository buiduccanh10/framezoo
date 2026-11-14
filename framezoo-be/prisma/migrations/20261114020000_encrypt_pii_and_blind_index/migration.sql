-- Store encrypted PII (AES-256-GCM ciphertext exceeds 255 chars) and keyed blind indexes.
DROP INDEX IF EXISTS "users_email_key";
ALTER TABLE "users"
  ALTER COLUMN "email" TYPE TEXT,
  ADD COLUMN "email_hash" VARCHAR(64);
CREATE UNIQUE INDEX "users_email_hash_key" ON "users"("email_hash");

DROP INDEX IF EXISTS "email_otp_challenges_email_purpose_created_at_idx";
ALTER TABLE "email_otp_challenges"
  ALTER COLUMN "email" TYPE TEXT,
  ADD COLUMN "email_hash" VARCHAR(64);
CREATE INDEX "email_otp_challenges_email_hash_purpose_created_at_idx"
  ON "email_otp_challenges"("email_hash", "purpose", "created_at");

ALTER TABLE "feedbacks"
  ALTER COLUMN "contact" TYPE TEXT,
  ADD COLUMN "contact_hash" VARCHAR(64);
CREATE INDEX "feedbacks_contact_hash_idx" ON "feedbacks"("contact_hash");
