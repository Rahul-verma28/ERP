-- Sales documents say which warehouse the goods leave from (and a return, which one they come back to)
ALTER TABLE "sales_documents" ADD COLUMN "location_id" UUID;
CREATE INDEX "sales_documents_tenant_id_location_id_idx" ON "sales_documents" ("tenant_id", "location_id");
-- A customer's delivery address when it differs from the billing address
ALTER TABLE "contacts" ADD COLUMN "shipping_address" JSONB;
