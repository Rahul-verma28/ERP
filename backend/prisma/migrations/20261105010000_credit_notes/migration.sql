-- Sales & Billing step 2: credit notes and sales returns. A credit note is a sales document
-- against an invoice; its lines point at the invoice lines so nothing is credited twice.
ALTER TYPE "sales_doc_kind" ADD VALUE IF NOT EXISTS 'credit_note';

ALTER TABLE "sales_documents" ADD COLUMN "credited_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "sales_documents" ADD COLUMN "note_type" TEXT;
ALTER TABLE "sales_documents" ADD COLUMN "source_number" TEXT;
CREATE INDEX "sales_documents_tenant_id_source_id_idx" ON "sales_documents"("tenant_id", "source_id");

ALTER TABLE "sales_document_lines" ADD COLUMN "source_line_id" UUID;
CREATE INDEX "sales_document_lines_tenant_id_source_line_id_idx" ON "sales_document_lines"("tenant_id", "source_line_id");

-- A credit note's value can go against invoices the same way an advance does
ALTER TABLE "advance_adjustments" ALTER COLUMN "payment_id" DROP NOT NULL;
ALTER TABLE "advance_adjustments" ADD COLUMN "credit_note_id" UUID;
CREATE INDEX "advance_adjustments_tenant_id_credit_note_id_idx" ON "advance_adjustments"("tenant_id", "credit_note_id");
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
