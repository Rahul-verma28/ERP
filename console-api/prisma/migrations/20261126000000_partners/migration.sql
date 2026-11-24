-- Partners: discount and state, monthly partner bills, website applications, KYC files
-- CreateEnum
CREATE TYPE "bill_status" AS ENUM ('awaiting_payment', 'paid', 'cancelled');

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "discount_bp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "state_code" TEXT;

-- CreateTable
CREATE TABLE "partner_bills" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" "bill_status" NOT NULL DEFAULT 'awaiting_payment',
    "lines" JSONB NOT NULL,
    "subtotal_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL DEFAULT 0,
    "sgst_paise" INTEGER NOT NULL DEFAULT 0,
    "igst_paise" INTEGER NOT NULL DEFAULT 0,
    "total_paise" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ NOT NULL,
    "link_id" TEXT,
    "link_url" TEXT,
    "paid_at" TIMESTAMPTZ,
    "payment_ref" TEXT,
    "invoice_number" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "city" TEXT,
    "state_code" TEXT,
    "gstin" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "result_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_files" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "field" TEXT NOT NULL DEFAULT 'kyc',
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "console_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_bills_link_id_key" ON "partner_bills"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_bills_invoice_number_key" ON "partner_bills"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "partner_bills_partner_id_month_key" ON "partner_bills"("partner_id", "month");

-- CreateIndex
CREATE INDEX "applications_status_created_at_idx" ON "applications"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "console_files_storage_key_key" ON "console_files"("storage_key");

-- CreateIndex
CREATE INDEX "console_files_entity_type_entity_id_idx" ON "console_files"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "partner_bills" ADD CONSTRAINT "partner_bills_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

