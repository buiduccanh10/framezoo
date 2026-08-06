/*
  Warnings:

  - You are about to drop the column `real_debrid_key` on the `user_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "user_settings" DROP COLUMN "real_debrid_key",
ADD COLUMN     "debrid_token" VARCHAR(255);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "nickname" DROP DEFAULT;

-- CreateTable
CREATE TABLE "watch_history" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "tmdb_id" VARCHAR(255) NOT NULL,
    "season_id" VARCHAR(255),
    "episode_id" VARCHAR(255),
    "meta" JSONB NOT NULL,
    "duration" BIGINT NOT NULL,
    "watched" BIGINT NOT NULL,
    "watched_at" TIMESTAMPTZ(0) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "season_number" INTEGER,
    "episode_number" INTEGER,
    "updated_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "watch_history_tmdb_id_user_id_season_id_episode_id_unique" ON "watch_history"("tmdb_id", "user_id", "season_id", "episode_id");
