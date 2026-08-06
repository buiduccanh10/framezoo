/*
  Warnings:

  - A unique constraint covering the columns `[nickname]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "users_public_key_unique";

-- CreateIndex
CREATE UNIQUE INDEX "users_nickname_key" ON "users"("nickname");
