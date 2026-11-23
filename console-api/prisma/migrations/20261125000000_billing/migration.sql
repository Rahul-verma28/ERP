-- Billing: orders, payments, invoices, credit notes, gateway events, numbering
-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending_approval', 'awaiting_payment', 'paid', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'awaiting_payment',
    "plan_key" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "extra_users" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "list_paise" INTEGER NOT NULL,
    "coupon_code" TEXT,
    "discount_pct" INTEGER,
    "discount_paise" INTEGER NOT NULL DEFAULT 0,
    "taxable_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL DEFAULT 0,
    "sgst_paise" INTEGER NOT NULL DEFAULT 0,
    "igst_paise" INTEGER NOT NULL DEFAULT 0,
    "total_paise" INTEGER NOT NULL,
    "bill_to" JSONB NOT NULL,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "link_id" TEXT,
    "link_url" TEXT,
    "link_sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reference" TEXT,
    "gateway_payment_id" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller" JSONB NOT NULL,
    "bill_to" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "taxable_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL,
    "sgst_paise" INTEGER NOT NULL,
    "igst_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "taxable_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL,
    "sgst_paise" INTEGER NOT NULL,
    "igst_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "doc_type" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "next_no" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("doc_type","fy")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_link_id_key" ON "orders"("link_id");

-- CreateIndex
CREATE INDEX "orders_business_id_created_at_idx" ON "orders"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "payments"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "payments_business_id_idx" ON "payments"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_order_id_key" ON "invoices"("order_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_idx" ON "invoices"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_number_key" ON "credit_notes"("number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_invoice_id_key" ON "credit_notes"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

