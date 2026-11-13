-- CRM: pipelines with lead and deal stages, deals, options (sources, labels, lost reasons), products of interest
ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'task';
ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'email';

CREATE TABLE "crm_pipelines" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_pipelines_tenant_id_idx" ON "crm_pipelines" ("tenant_id");

CREATE TABLE "crm_stages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "pipeline_id" UUID NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "name" TEXT NOT NULL,
  "color" VARCHAR(10) NOT NULL DEFAULT 'blue',
  "position" INTEGER NOT NULL DEFAULT 0,
  "probability" INTEGER,
  CONSTRAINT "crm_stages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_stages_tenant_id_pipeline_id_kind_idx" ON "crm_stages" ("tenant_id", "pipeline_id", "kind");

CREATE TABLE "crm_options" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kind" VARCHAR(12) NOT NULL,
  "name" TEXT NOT NULL,
  "color" VARCHAR(10),
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "crm_options_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_options_tenant_id_kind_name_key" ON "crm_options" ("tenant_id", "kind", "name");

CREATE TABLE "deals" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "contact_id" UUID NOT NULL,
  "lead_id" UUID,
  "pipeline_id" UUID NOT NULL,
  "stage_id" UUID NOT NULL,
  "value_paise" BIGINT NOT NULL DEFAULT 0,
  "status" VARCHAR(6) NOT NULL DEFAULT 'open',
  "lost_reason" TEXT,
  "expected_close_on" DATE,
  "source" TEXT,
  "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "owner_id" UUID,
  "created_by" UUID,
  "closed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "deals_tenant_id_pipeline_id_status_idx" ON "deals" ("tenant_id", "pipeline_id", "status");
CREATE INDEX "deals_tenant_id_contact_id_idx" ON "deals" ("tenant_id", "contact_id");

CREATE TABLE "crm_products" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "contact_id" UUID,
  "deal_id" UUID,
  "item_id" UUID NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
  "price_paise" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "crm_products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_products_tenant_id_contact_id_idx" ON "crm_products" ("tenant_id", "contact_id");
CREATE INDEX "crm_products_tenant_id_deal_id_idx" ON "crm_products" ("tenant_id", "deal_id");

ALTER TABLE "contacts" ADD COLUMN "subject" TEXT;
ALTER TABLE "contacts" ADD COLUMN "pipeline_id" UUID;
ALTER TABLE "contacts" ADD COLUMN "stage_id" UUID;
ALTER TABLE "contacts" ADD COLUMN "follow_up_on" DATE;
ALTER TABLE "contacts" ADD COLUMN "value_paise" BIGINT;
ALTER TABLE "contacts" ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "contacts" ADD COLUMN "lost_reason" TEXT;

ALTER TABLE "activities" ADD COLUMN "deal_id" UUID;
CREATE INDEX "activities_tenant_id_deal_id_idx" ON "activities" ("tenant_id", "deal_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_pipelines', 'crm_stages', 'crm_options', 'deals', 'crm_products'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
