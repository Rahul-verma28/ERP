-- Sales & Billing steps 4 and 7: round-off on bills, and sales orders (invoiced in parts).
ALTER TYPE "sales_doc_kind" ADD VALUE IF NOT EXISTS 'sales_order';
ALTER TYPE "sales_doc_status" ADD VALUE IF NOT EXISTS 'open';
ALTER TYPE "sales_doc_status" ADD VALUE IF NOT EXISTS 'part_invoiced';
ALTER TYPE "sales_doc_status" ADD VALUE IF NOT EXISTS 'completed';

ALTER TABLE "sales_documents" ADD COLUMN "round_off_paise" BIGINT NOT NULL DEFAULT 0;
