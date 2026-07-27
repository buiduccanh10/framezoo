-- Replace invite-based registration with an optional email identity.
ALTER TABLE "users" ADD COLUMN "email" VARCHAR(255);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

ALTER TABLE "users" DROP COLUMN "invited_by";
