-- Sales & Billing batch 2 (no outside account): numbers the GST portals give back, and reminder history.
ALTER TABLE "sales_documents" ADD COLUMN "eway_bill_no" VARCHAR(12);
ALTER TABLE "sales_documents" ADD COLUMN "eway_bill_date" DATE;
ALTER TABLE "sales_documents" ADD COLUMN "irn" CHAR(64);
ALTER TABLE "sales_documents" ADD COLUMN "irn_ack_no" VARCHAR(20);
ALTER TABLE "sales_documents" ADD COLUMN "irn_ack_date" DATE;

ALTER TABLE "contacts" ADD COLUMN "last_reminded_at" TIMESTAMPTZ;
ALTER TABLE "contacts" ADD COLUMN "last_reminder_via" VARCHAR(10);
