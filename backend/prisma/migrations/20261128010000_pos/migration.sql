-- POS (Counter billing, BIL-08): counters, shifts with opening and closing cash, cash put in or
-- taken out of the drawer, and bills put on hold. A counter sale is an ordinary GST invoice
-- (source_type 'pos', source_id = the shift) paid by receipts tied to the shift.

CREATE TABLE "pos_counters" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" VARCHAR(60) NOT NULL,
  "branch_id" UUID, "location_id" UUID, "cash_account_id" UUID, "bank_account_id" UUID,
  "paper" VARCHAR(4) NOT NULL DEFAULT '80mm', "receipt_note" TEXT,
  "max_discount_bp" INTEGER, "allow_credit" BOOLEAN NOT NULL DEFAULT true, "need_customer" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "pos_counters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_counters_paper_check" CHECK ("paper" IN ('80mm', '58mm', 'a4')),
  CONSTRAINT "pos_counters_discount_check" CHECK ("max_discount_bp" IS NULL OR "max_discount_bp" BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX "pos_counters_tenant_id_name_key" ON "pos_counters" ("tenant_id", "name");

CREATE TABLE "pos_shifts" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "counter_id" UUID NOT NULL, "number" VARCHAR(20) NOT NULL,
  "status" VARCHAR(8) NOT NULL DEFAULT 'open',
  "opened_by" UUID NOT NULL, "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "opening_cash_paise" BIGINT NOT NULL DEFAULT 0,
  "closed_by" UUID, "closed_at" TIMESTAMPTZ,
  "expected_cash_paise" BIGINT, "counted_cash_paise" BIGINT, "difference_paise" BIGINT,
  "denominations" JSONB, "closing_note" TEXT, "deposit_paise" BIGINT NOT NULL DEFAULT 0, "deposit_transfer_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_shifts_counter_fkey" FOREIGN KEY ("counter_id") REFERENCES "pos_counters"("id"),
  CONSTRAINT "pos_shifts_status_check" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "pos_shifts_cash_check" CHECK ("opening_cash_paise" >= 0 AND ("counted_cash_paise" IS NULL OR "counted_cash_paise" >= 0) AND "deposit_paise" >= 0)
);
CREATE UNIQUE INDEX "pos_shifts_tenant_id_number_key" ON "pos_shifts" ("tenant_id", "number");
-- One open shift per counter, and one per person
CREATE UNIQUE INDEX "pos_shifts_open_counter_key" ON "pos_shifts" ("counter_id") WHERE "status" = 'open';
CREATE UNIQUE INDEX "pos_shifts_open_person_key" ON "pos_shifts" ("tenant_id", "opened_by") WHERE "status" = 'open';
CREATE INDEX "pos_shifts_tenant_id_opened_at_idx" ON "pos_shifts" ("tenant_id", "opened_at");

CREATE TABLE "pos_cash_moves" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "shift_id" UUID NOT NULL,
  "kind" VARCHAR(4) NOT NULL, "amount_paise" BIGINT NOT NULL, "reason" VARCHAR(16) NOT NULL, "note" TEXT,
  "expense_id" UUID, "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pos_cash_moves_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_cash_moves_shift_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id"),
  CONSTRAINT "pos_cash_moves_kind_check" CHECK ("kind" IN ('in', 'out')),
  CONSTRAINT "pos_cash_moves_amount_check" CHECK ("amount_paise" > 0)
);
CREATE INDEX "pos_cash_moves_shift_id_idx" ON "pos_cash_moves" ("shift_id");

CREATE TABLE "pos_held_bills" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "counter_id" UUID NOT NULL,
  "label" VARCHAR(60) NOT NULL, "cart" JSONB NOT NULL, "total_paise" BIGINT NOT NULL DEFAULT 0, "lines" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pos_held_bills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_held_bills_counter_fkey" FOREIGN KEY ("counter_id") REFERENCES "pos_counters"("id") ON DELETE CASCADE
);
CREATE INDEX "pos_held_bills_counter_id_idx" ON "pos_held_bills" ("counter_id");

-- Receipts and refunds taken at a counter belong to its shift
ALTER TABLE "payments_received" ADD COLUMN "pos_shift_id" UUID;
CREATE INDEX "payments_received_pos_shift_id_idx" ON "payments_received" ("pos_shift_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_counters', 'pos_shifts', 'pos_cash_moves', 'pos_held_bills'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
