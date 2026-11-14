-- Finance: cash and bank accounts, expense/income categories, other income, transfers.
-- Money already received or paid gets the account it went through.

CREATE TABLE "fin_accounts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "bank_name" TEXT,
  "account_no" VARCHAR(30),
  "ifsc" VARCHAR(11),
  "upi_id" TEXT,
  "opening_paise" BIGINT NOT NULL DEFAULT 0,
  "opening_date" DATE,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "fin_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fin_accounts_tenant_id_idx" ON "fin_accounts" ("tenant_id");

CREATE TABLE "fin_categories" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kind" VARCHAR(8) NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "fin_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_categories_tenant_id_kind_name_key" ON "fin_categories" ("tenant_id", "kind", "name");

CREATE TABLE "incomes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "received_on" DATE NOT NULL,
  "category" TEXT NOT NULL,
  "account_id" UUID NOT NULL,
  "amount_paise" BIGINT NOT NULL,
  "payer" TEXT,
  "contact_id" UUID,
  "reference" TEXT,
  "notes" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "incomes_tenant_id_received_on_idx" ON "incomes" ("tenant_id", "received_on");

CREATE TABLE "fin_transfers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "transfer_on" DATE NOT NULL,
  "from_account_id" UUID NOT NULL,
  "to_account_id" UUID NOT NULL,
  "amount_paise" BIGINT NOT NULL,
  "charges_paise" BIGINT NOT NULL DEFAULT 0,
  "reference" TEXT,
  "notes" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "fin_transfers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fin_transfers_tenant_id_transfer_on_idx" ON "fin_transfers" ("tenant_id", "transfer_on");

ALTER TABLE "expenses" ADD COLUMN "number" TEXT;
ALTER TABLE "expenses" ADD COLUMN "account_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "contact_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "reference" TEXT;
ALTER TABLE "expenses" ADD COLUMN "bill_no" TEXT;
ALTER TABLE "expenses" ADD COLUMN "vendor_gstin" VARCHAR(15);
ALTER TABLE "expenses" ADD COLUMN "taxable_paise" BIGINT;
ALTER TABLE "expenses" ADD COLUMN "gst_rate_bp" INTEGER;
ALTER TABLE "expenses" ADD COLUMN "gst_paise" BIGINT;

ALTER TABLE "payments_received" ADD COLUMN "account_id" UUID;
ALTER TABLE "supplier_payments" ADD COLUMN "account_id" UUID;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fin_accounts', 'fin_categories', 'incomes', 'fin_transfers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
