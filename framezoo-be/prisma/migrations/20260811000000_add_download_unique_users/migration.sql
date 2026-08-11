-- CreateTable
CREATE TABLE "download_unique_users" (
    "id" UUID NOT NULL,
    "identity_type" VARCHAR(16) NOT NULL,
    "identity_key" VARCHAR(255) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "option_id" VARCHAR(64) NOT NULL,
    "first_downloaded_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_downloaded_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_unique_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "download_unique_users_identity_version_option_unique"
ON "download_unique_users"("identity_type", "identity_key", "version", "option_id");

-- CreateIndex
CREATE INDEX "download_unique_users_version_option_idx"
ON "download_unique_users"("version", "option_id");
