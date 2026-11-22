-- Uploaded files: photos and documents on any record. The bytes live in file storage
-- (local disk in development, S3/R2 later); this table holds what each file is and whose it is.
-- A record points at a file either through one of its own columns ("file:<id>") or, for a list
-- of files, through entity_type + entity_id here.
CREATE TABLE "files" (
  "id"           UUID PRIMARY KEY,
  "tenant_id"    UUID,                       -- empty only for AHEAD Console files (partner KYC)
  "entity_type"  VARCHAR(32),                -- e.g. task, customer, supplier, item, ticket, partner
  "entity_id"    UUID,
  "field"        VARCHAR(32) NOT NULL DEFAULT 'attachments',
  "name"         VARCHAR(200) NOT NULL,
  "mime"         VARCHAR(100) NOT NULL,
  "size_bytes"   INTEGER NOT NULL,
  "sha256"       CHAR(64) NOT NULL,
  "storage_key"  VARCHAR(300) NOT NULL,
  "uploaded_by"  UUID,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "files_tenant_id_entity_idx" ON "files" ("tenant_id", "entity_type", "entity_id");

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "files" USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON "files" TO app_user;

-- One file on records that had no place for it
ALTER TABLE "leave_applications" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "incomes" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "payments_received" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "supplier_payments" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "purchase_documents" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "stock_entries" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "appointments" ADD COLUMN "attachment_url" TEXT;
ALTER TABLE "hr_loans" ADD COLUMN "document_url" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_url" TEXT;

-- A leave type can ask for proof (a medical certificate) when the leave is longer than N days
ALTER TABLE "leave_types" ADD COLUMN "proof_after_days" DECIMAL(5, 1);
