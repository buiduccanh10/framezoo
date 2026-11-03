-- AlterTable
ALTER TABLE "user_settings"
ADD COLUMN "native_subtitles_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "user_provider_credentials" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "user_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_provider_credentials_user_id_provider_key"
ON "user_provider_credentials"("user_id", "provider");

-- CreateIndex
CREATE INDEX "user_provider_credentials_user_id_idx"
ON "user_provider_credentials"("user_id");

-- AddForeignKey
ALTER TABLE "user_provider_credentials"
ADD CONSTRAINT "user_provider_credentials_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
