-- Legal compliance fields for users & feedbacks, plus takedown blocklist rules
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "terms_version" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "privacy_version" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "consented_at" TIMESTAMPTZ(0),
  ADD COLUMN IF NOT EXISTS "consent_platform" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "age_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_suspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ(0),
  ADD COLUMN IF NOT EXISTS "suspended_reason" VARCHAR(255);

ALTER TABLE "feedbacks"
  ADD COLUMN IF NOT EXISTS "category" VARCHAR(32) NOT NULL DEFAULT 'bug',
  ADD COLUMN IF NOT EXISTS "target_url_or_id" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "rights_owner_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "sworn_statement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sla_due_at" TIMESTAMPTZ(0),
  ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMPTZ(0);

CREATE INDEX IF NOT EXISTS "feedbacks_category_idx" ON "feedbacks"("category");

CREATE TABLE IF NOT EXISTS "takedown_rules" (
  "id" UUID NOT NULL,
  "target_type" VARCHAR(32) NOT NULL,
  "pattern" VARCHAR(500) NOT NULL,
  "reason" TEXT NOT NULL,
  "rights_holder" VARCHAR(255),
  "reference_id" VARCHAR(255),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" VARCHAR(255),

  CONSTRAINT "takedown_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "takedown_rules_type_active_idx" ON "takedown_rules"("target_type", "active");
