-- Inventory batch 2: batches with expiry, serial numbers, a second unit, barcodes, variants,
-- cost layers (FIFO and ageing), transfers in transit, and batch and serials on bill lines.
ALTER TABLE "items" ADD COLUMN "tracking" VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE "items" ADD COLUMN "alt_unit" VARCHAR(20);
ALTER TABLE "items" ADD COLUMN "alt_factor" DECIMAL(18,3);
ALTER TABLE "items" ADD COLUMN "barcode" VARCHAR(48);
ALTER TABLE "items" ADD COLUMN "variant_group" VARCHAR(160);
ALTER TABLE "items" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX "items_tenant_id_barcode_key" ON "items"("tenant_id", "barcode") WHERE "barcode" IS NOT NULL;

ALTER TABLE "sales_document_lines" ADD COLUMN "batch_id" UUID;
ALTER TABLE "sales_document_lines" ADD COLUMN "serials" TEXT[] NOT NULL DEFAULT '{}';
-- The batches the stock actually came from, frozen for printing: [{ number, expiry, quantity }]
ALTER TABLE "sales_document_lines" ADD COLUMN "batches" JSONB;

ALTER TABLE "stock_moves" ADD COLUMN "batch_id" UUID;
ALTER TABLE "stock_moves" ADD COLUMN "serials" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "stock_entries" ADD COLUMN "status" VARCHAR(12) NOT NULL DEFAULT 'posted';
ALTER TABLE "stock_entries" ADD COLUMN "received_at" TIMESTAMPTZ;

CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "mfg_date" DATE,
    "expiry_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_batches_item_id_number_key" ON "stock_batches"("item_id", "number");
CREATE INDEX "stock_batches_tenant_id_expiry_date_idx" ON "stock_batches"("tenant_id", "expiry_date");

CREATE TABLE "stock_batch_balances" (
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    CONSTRAINT "stock_batch_balances_pkey" PRIMARY KEY ("batch_id", "location_id")
);
CREATE INDEX "stock_batch_balances_tenant_id_idx" ON "stock_batch_balances"("tenant_id");

CREATE TABLE "stock_serials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "serial" VARCHAR(40) NOT NULL,
    -- in_stock | sold | transit | gone
    "status" VARCHAR(12) NOT NULL,
    "location_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_serials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_serials_item_id_serial_key" ON "stock_serials"("item_id", "serial");
CREATE INDEX "stock_serials_tenant_id_serial_idx" ON "stock_serials"("tenant_id", "serial");

-- What is left of each receipt, oldest first: FIFO cost and stock ageing come from here
CREATE TABLE "stock_layers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "received_on" DATE NOT NULL,
    "qty_remaining" DECIMAL(18,3) NOT NULL,
    "rate_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_layers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_layers_item_id_location_id_received_on_idx" ON "stock_layers"("item_id", "location_id", "received_on");
CREATE INDEX "stock_layers_tenant_id_idx" ON "stock_layers"("tenant_id");

-- Stock already on hand becomes one layer per item and godown, dated by its last receipt
INSERT INTO "stock_layers" ("id", "tenant_id", "item_id", "location_id", "received_on", "qty_remaining", "rate_paise")
SELECT gen_random_uuid(), b.tenant_id, b.item_id, b.location_id,
       COALESCE((SELECT MAX(m.move_date) FROM stock_moves m WHERE m.item_id = b.item_id AND m.location_id = b.location_id AND m.quantity > 0), CURRENT_DATE),
       b.quantity, CASE WHEN b.quantity > 0 THEN ROUND(b.value_paise / b.quantity) ELSE 0 END
FROM stock_balances b WHERE b.quantity > 0;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_batches', 'stock_batch_balances', 'stock_serials', 'stock_layers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
