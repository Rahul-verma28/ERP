-- HR records that share one shape: trainers, candidate assessments, offers,
-- onboarding checklists and candidate onboardings. Each kind is validated in code.

CREATE TABLE "hr_records" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "ref_id" UUID,
  "status" VARCHAR(16) NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "hr_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_records_tenant_id_kind_idx" ON "hr_records" ("tenant_id", "kind");
CREATE INDEX "hr_records_ref_id_idx" ON "hr_records" ("ref_id");

ALTER TABLE "hr_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hr_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hr_records" USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_records" TO app_user;
