-- Purchase batch 1: suppliers, purchase orders, goods receipts, purchase bills, purchase returns,
-- payments to suppliers. Purchase lives inside the Inventory module key.
ALTER TYPE "contact_type" ADD VALUE IF NOT EXISTS 'supplier';
ALTER TABLE "items" ADD COLUMN "preferred_supplier_id" UUID;

CREATE TABLE "purchase_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    -- purchase_order | goods_receipt | purchase_bill | purchase_return
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "number" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "contact_id" UUID NOT NULL,
    "supplier" JSONB NOT NULL DEFAULT '{}',
    -- The supplier's own invoice or challan number and date
    "supplier_ref" VARCHAR(40),
    "supplier_date" DATE,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "place_of_supply" CHAR(2),
    "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "location_id" UUID,
    "subtotal_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_paise" BIGINT NOT NULL DEFAULT 0,
    -- Freight, loading and the like, before GST, spread over the goods as landed cost
    "charges_paise" BIGINT NOT NULL DEFAULT 0,
    "charges_gst_bp" INTEGER NOT NULL DEFAULT 0,
    "round_off_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL DEFAULT 0,
    "paid_paise" BIGINT NOT NULL DEFAULT 0,
    "returned_paise" BIGINT NOT NULL DEFAULT 0,
    "source_type" VARCHAR(16),
    "source_id" UUID,
    "source_number" TEXT,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "purchase_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_documents_tenant_id_kind_number_key" ON "purchase_documents"("tenant_id", "kind", "number");
CREATE INDEX "purchase_documents_tenant_id_kind_status_issue_date_idx" ON "purchase_documents"("tenant_id", "kind", "status", "issue_date");
CREATE INDEX "purchase_documents_tenant_id_contact_id_idx" ON "purchase_documents"("tenant_id", "contact_id");
CREATE INDEX "purchase_documents_tenant_id_source_id_idx" ON "purchase_documents"("tenant_id", "source_id");

CREATE TABLE "purchase_document_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "item_id" UUID,
    "description" TEXT NOT NULL,
    "hsn_sac" VARCHAR(10),
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price_paise" BIGINT NOT NULL,
    "discount_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_paise" BIGINT NOT NULL,
    "gst_rate_bp" INTEGER NOT NULL,
    "cgst_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL,
    -- Share of the bill's other charges added to this line's stock cost
    "landed_paise" BIGINT NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source_line_id" UUID,
    "batch_no" VARCHAR(40),
    "mfg_date" DATE,
    "expiry_date" DATE,
    "serials" TEXT[] NOT NULL DEFAULT '{}',
    CONSTRAINT "purchase_document_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_document_lines_tenant_id_document_id_idx" ON "purchase_document_lines"("tenant_id", "document_id");
CREATE INDEX "purchase_document_lines_tenant_id_source_line_id_idx" ON "purchase_document_lines"("tenant_id", "source_line_id");
ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "purchase_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    -- Negative on a reversal
    "amount_paise" BIGINT NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "reference" TEXT,
    "paid_on" DATE NOT NULL,
    "reverses_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_payments_reverses_id_key" ON "supplier_payments"("reverses_id");
CREATE INDEX "supplier_payments_tenant_id_contact_id_idx" ON "supplier_payments"("tenant_id", "contact_id");
CREATE INDEX "supplier_payments_tenant_id_document_id_idx" ON "supplier_payments"("tenant_id", "document_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_documents', 'purchase_document_lines', 'supplier_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
