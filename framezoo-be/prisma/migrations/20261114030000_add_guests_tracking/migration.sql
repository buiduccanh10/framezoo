-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL,
    "app_version" VARCHAR(64),
    "platform" VARCHAR(64),
    "user_agent" VARCHAR(1024),
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guests_last_seen_at_idx" ON "guests"("last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "guests_first_seen_at_idx" ON "guests"("first_seen_at" DESC);

-- CreateIndex
CREATE INDEX "guests_app_version_idx" ON "guests"("app_version");
