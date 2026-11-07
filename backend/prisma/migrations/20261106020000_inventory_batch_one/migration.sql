-- Inventory batch 1: godowns, one append-only stock ledger, running balances, stock entries.
ALTER TABLE "items" ADD COLUMN "track_stock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN "reorder_level" DECIMAL(18,3);

CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_locations_tenant_id_name_key" ON "stock_locations"("tenant_id", "name");

-- A stock entry groups the lines of one opening, stock in, adjustment, transfer or count
CREATE TABLE "stock_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "location_id" UUID NOT NULL,
    "to_location_id" UUID,
    "entry_date" DATE NOT NULL,
    "party" TEXT,
    "reference" TEXT,
    "reason" VARCHAR(20),
    "note" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "value_paise" BIGINT NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_entries_tenant_id_entry_date_idx" ON "stock_entries"("tenant_id", "entry_date");

CREATE TABLE "stock_moves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "move_date" DATE NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "rate_paise" BIGINT NOT NULL,
    "value_paise" BIGINT NOT NULL,
    "balance_qty" DECIMAL(18,3) NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_id" UUID NOT NULL,
    "source_line_id" UUID,
    "reverses_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_moves_tenant_id_item_id_location_id_created_at_idx" ON "stock_moves"("tenant_id", "item_id", "location_id", "created_at");
CREATE INDEX "stock_moves_tenant_id_source_id_idx" ON "stock_moves"("tenant_id", "source_id");
-- A move is undone once, by one opposite move
CREATE UNIQUE INDEX "stock_moves_reverses_id_key" ON "stock_moves"("reverses_id");

CREATE TABLE "stock_balances" (
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "value_paise" BIGINT NOT NULL DEFAULT 0,
    "last_rate_paise" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("item_id", "location_id")
);
CREATE INDEX "stock_balances_tenant_id_idx" ON "stock_balances"("tenant_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_locations', 'stock_entries', 'stock_moves', 'stock_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
