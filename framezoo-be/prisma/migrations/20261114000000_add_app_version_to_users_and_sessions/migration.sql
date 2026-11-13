-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "app_version" VARCHAR(64);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "app_version" VARCHAR(64);
