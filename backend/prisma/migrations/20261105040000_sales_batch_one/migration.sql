-- Sales & Billing batch 1: delivery challans, debit notes, ship-to, free quantity, credit limits, price lists.
ALTER TYPE "sales_doc_kind" ADD VALUE IF NOT EXISTS 'delivery_challan';
ALTER TYPE "sales_doc_kind" ADD VALUE IF NOT EXISTS 'debit_note';

ALTER TABLE "sales_documents" ADD COLUMN "ship_to" JSONB;
ALTER TABLE "sales_document_lines" ADD COLUMN "free_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0;

CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "price_lists_tenant_id_name_key" ON "price_lists"("tenant_id", "name");

CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "price_paise" BIGINT NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "price_list_items_price_list_id_item_id_key" ON "price_list_items"("price_list_id", "item_id");
CREATE INDEX "price_list_items_tenant_id_item_id_idx" ON "price_list_items"("tenant_id", "item_id");
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contacts" ADD COLUMN "credit_limit_paise" BIGINT;
ALTER TABLE "contacts" ADD COLUMN "price_list_id" UUID;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['price_lists', 'price_list_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
