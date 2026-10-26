ALTER TABLE "feedbacks"
ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;
