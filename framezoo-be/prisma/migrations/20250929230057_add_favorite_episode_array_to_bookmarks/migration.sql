-- AlterTable
ALTER TABLE "bookmarks" ADD COLUMN     "favorite_episodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
