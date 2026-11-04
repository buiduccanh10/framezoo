CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "challenge_id" UUID,
    "dedupe_key" VARCHAR(255) NOT NULL,
    "payload_ciphertext" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(0),
    "sent_at" TIMESTAMPTZ(0),
    "provider_message_id" VARCHAR(512),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");
CREATE INDEX "email_outbox_status_available_at_idx" ON "email_outbox"("status", "available_at");
CREATE INDEX "email_outbox_challenge_id_idx" ON "email_outbox"("challenge_id");

CREATE TABLE "otp_idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(512) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(128) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'processing',
    "response_json" JSONB,
    "expires_at" TIMESTAMPTZ(0) NOT NULL,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "otp_idempotency_keys_scope_key_key" ON "otp_idempotency_keys"("scope", "key");
CREATE INDEX "otp_idempotency_keys_expires_at_idx" ON "otp_idempotency_keys"("expires_at");
