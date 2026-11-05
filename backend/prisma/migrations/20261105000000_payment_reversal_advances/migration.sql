-- Sales & Billing step 1: wrong receipts are reversed with an opposite entry (receipts stay
-- append-only), and customers can pay in advance without an invoice.
ALTER TABLE "payments_received" ALTER COLUMN "document_id" DROP NOT NULL;
ALTER TABLE "payments_received" ADD COLUMN "reverses_id" UUID;
CREATE UNIQUE INDEX "payments_received_reverses_id_key" ON "payments_received"("reverses_id");
CREATE INDEX "payments_received_tenant_id_contact_id_idx" ON "payments_received"("tenant_id", "contact_id");
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "payments_received"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- How much of an advance went against which invoice. Removing one adds an opposite row.
CREATE TABLE "advance_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "reverses_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "advance_adjustments_reverses_id_key" ON "advance_adjustments"("reverses_id");
CREATE INDEX "advance_adjustments_tenant_id_payment_id_idx" ON "advance_adjustments"("tenant_id", "payment_id");
CREATE INDEX "advance_adjustments_tenant_id_document_id_idx" ON "advance_adjustments"("tenant_id", "document_id");
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments_received"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "advance_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "advance_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advance_adjustments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "advance_adjustments" USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON "advance_adjustments" TO app_user;
