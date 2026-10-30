-- Console Phase D.
-- 1. Plan drafts: an Admin edits a plan as a draft, sees who it affects, then publishes it.
--    Platform table (no RLS, no app_user grant).
CREATE TABLE "plan_drafts" (
  "plan_key" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "plan_drafts_pkey" PRIMARY KEY ("plan_key"),
  CONSTRAINT "plan_drafts_plan_fkey" FOREIGN KEY ("plan_key") REFERENCES "plans"("key") ON DELETE CASCADE
);

-- 2. Module switches for one business: turn a module on beyond the plan (a demo, a special deal)
--    or off, optionally until a date. Read by the entitlement service inside the business's own
--    transaction, so it carries RLS like every tenant table; only the Console writes it.
CREATE TABLE "tenant_module_overrides" (
  "tenant_id" UUID NOT NULL,
  "module_key" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "until" TIMESTAMPTZ,
  "reason" TEXT NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_module_overrides_pkey" PRIMARY KEY ("tenant_id", "module_key"),
  CONSTRAINT "tenant_module_overrides_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "tenant_module_overrides_module_fkey" FOREIGN KEY ("module_key") REFERENCES "modules"("key"),
  CONSTRAINT "tenant_module_overrides_state_check" CHECK ("state" IN ('on', 'off'))
);
ALTER TABLE "tenant_module_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_module_overrides" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_module_overrides" USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT ON "tenant_module_overrides" TO app_user;
