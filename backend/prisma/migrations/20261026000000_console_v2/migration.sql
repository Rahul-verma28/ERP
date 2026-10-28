-- Phase 4: Console revamp — prospects, follow-ups and internal notes for the AHEAD team.
-- Platform tables (no RLS): only the Console reads and writes them, with explicit scope filters.

CREATE TABLE "console_prospects" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "business_name" TEXT NOT NULL,
  "industry_key" TEXT,
  "city" TEXT,
  "mobile" VARCHAR(15),
  "email" TEXT,
  "source" TEXT,
  "stage" TEXT NOT NULL DEFAULT 'new',
  "lost_reason" TEXT,
  "owner_user_id" UUID NOT NULL,
  "tenant_id" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "console_prospects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "console_prospects_stage_check" CHECK ("stage" IN ('new', 'contacted', 'demo', 'trial', 'won', 'lost'))
);
CREATE INDEX "console_prospects_owner_idx" ON "console_prospects" ("owner_user_id", "stage");
CREATE INDEX "console_prospects_mobile_idx" ON "console_prospects" ("mobile");
CREATE INDEX "console_prospects_tenant_idx" ON "console_prospects" ("tenant_id");

CREATE TABLE "console_followups" (
  "id" UUID NOT NULL,
  "prospect_id" UUID,
  "tenant_id" UUID,
  "title" TEXT NOT NULL,
  "due_at" TIMESTAMPTZ NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "done_at" TIMESTAMPTZ,
  -- Automatic follow-ups (trial without invoice, trial ending, unpaid order) are made once per key
  "auto_key" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "console_followups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "console_followups_prospect_fkey" FOREIGN KEY ("prospect_id") REFERENCES "console_prospects"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "console_followups_auto_key" ON "console_followups" ("auto_key");
CREATE INDEX "console_followups_owner_idx" ON "console_followups" ("owner_user_id", "done_at", "due_at");
CREATE INDEX "console_followups_tenant_idx" ON "console_followups" ("tenant_id");

CREATE TABLE "console_notes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID,
  "prospect_id" UUID,
  "body" TEXT NOT NULL,
  "private_to_team" BOOLEAN NOT NULL DEFAULT false,
  "author_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "console_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "console_notes_prospect_fkey" FOREIGN KEY ("prospect_id") REFERENCES "console_prospects"("id") ON DELETE CASCADE
);
CREATE INDEX "console_notes_tenant_idx" ON "console_notes" ("tenant_id", "created_at" DESC);
