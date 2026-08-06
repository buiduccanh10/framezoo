/*
  Warnings:

  - The `group` column on the `bookmarks` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "bookmarks" DROP COLUMN "group",
ADD COLUMN     "group" TEXT[];
