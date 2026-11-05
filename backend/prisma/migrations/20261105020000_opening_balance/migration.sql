-- Sales & Billing step 3: what a customer already owed before using AHEAD. It is a sales document
-- so payments can go against it and dues count it, but sales and GST never see it.
ALTER TYPE "sales_doc_kind" ADD VALUE IF NOT EXISTS 'opening_balance';

-- One live opening balance per customer
CREATE UNIQUE INDEX "sales_documents_one_opening_balance" ON "sales_documents"("tenant_id", "contact_id") WHERE "note_type" = 'opening' AND "status" <> 'cancelled';
