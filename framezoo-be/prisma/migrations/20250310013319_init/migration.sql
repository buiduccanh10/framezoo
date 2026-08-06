-- CreateTable
CREATE TABLE "bookmarks" (
    "tmdb_id" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "meta" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("tmdb_id","user_id")
);

-- CreateTable
CREATE TABLE "challenge_codes" (
    "code" UUID NOT NULL,
    "flow" TEXT NOT NULL,
    "auth_type" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(0) NOT NULL,
    "expires_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "challenge_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "mikro_orm_migrations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "executed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mikro_orm_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_items" (
    "id" UUID NOT NULL,
    "tmdb_id" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "season_id" VARCHAR(255),
    "episode_id" VARCHAR(255),
    "meta" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,
    "duration" BIGINT NOT NULL,
    "watched" BIGINT NOT NULL,
    "season_number" INTEGER,
    "episode_number" INTEGER,

    CONSTRAINT "progress_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(0) NOT NULL,
    "accessed_at" TIMESTAMPTZ(0) NOT NULL,
    "expires_at" TIMESTAMPTZ(0) NOT NULL,
    "device" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "application_theme" VARCHAR(255),
    "application_language" VARCHAR(255),
    "default_subtitle_language" VARCHAR(255),
    "proxy_urls" TEXT[],
    "febbox_key" VARCHAR(255),

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "namespace" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(0) NOT NULL,
    "last_logged_in" TIMESTAMPTZ(0),
    "permissions" TEXT[],
    "profile" JSONB NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_tmdb_id_user_id_unique" ON "bookmarks"("tmdb_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "progress_items_tmdb_id_user_id_season_id_episode_id_unique" ON "progress_items"("tmdb_id", "user_id", "season_id", "episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_public_key_unique" ON "users"("public_key");
