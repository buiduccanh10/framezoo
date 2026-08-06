-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ratings" JSONB NOT NULL DEFAULT '{}';
