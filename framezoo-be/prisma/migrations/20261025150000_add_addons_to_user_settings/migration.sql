-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "addons" JSONB DEFAULT '[]'::jsonb;
