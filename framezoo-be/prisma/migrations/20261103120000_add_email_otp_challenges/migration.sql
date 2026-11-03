-- Add email verification state to legacy custom-auth users.
ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMPTZ(0);

-- OTP challenges are owned by the existing backend auth flow.
CREATE TABLE "email_otp_challenges" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "user_id" TEXT,
    "email" VARCHAR(255) NOT NULL,
    "payload" JSONB,
    "code_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(0) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_sent_at" TIMESTAMPTZ(0),
    "verified_at" TIMESTAMPTZ(0),
    "consumed_at" TIMESTAMPTZ(0),
    "action_token_hash" VARCHAR(128),
    "action_expires_at" TIMESTAMPTZ(0),
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_ip" VARCHAR(255),

    CONSTRAINT "email_otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_otp_challenges_email_purpose_created_at_idx"
ON "email_otp_challenges"("email", "purpose", "created_at");

CREATE INDEX "email_otp_challenges_user_id_purpose_created_at_idx"
ON "email_otp_challenges"("user_id", "purpose", "created_at");

CREATE INDEX "email_otp_challenges_action_token_hash_idx"
ON "email_otp_challenges"("action_token_hash");
