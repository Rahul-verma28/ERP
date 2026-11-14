-- Finance books: your own ledgers (loans, capital, fixed assets), journal entries,
-- repeating expenses, bank reconciliation marks and a monthly budget per expense category.

CREATE TABLE "fin_ledgers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "group" VARCHAR(10) NOT NULL,
  "code" VARCHAR(10),
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "fin_ledgers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_ledgers_tenant_id_name_key" ON "fin_ledgers" ("tenant_id", "name");

CREATE TABLE "journals" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "journal_on" DATE NOT NULL,
  "narration" TEXT NOT NULL,
  "reference" TEXT,
  "total_paise" BIGINT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "journals_tenant_id_journal_on_idx" ON "journals" ("tenant_id", "journal_on");

CREATE TABLE "journal_lines" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "journal_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "ledger_key" VARCHAR(80) NOT NULL,
  "debit_paise" BIGINT NOT NULL DEFAULT 0,
  "credit_paise" BIGINT NOT NULL DEFAULT 0,
  "description" TEXT,
  CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "journal_lines_tenant_id_ledger_key_idx" ON "journal_lines" ("tenant_id", "ledger_key");
CREATE INDEX "journal_lines_journal_id_idx" ON "journal_lines" ("journal_id");

CREATE TABLE "recurring_expenses" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "every" VARCHAR(10) NOT NULL,
  "next_on" DATE NOT NULL,
  "ends_on" DATE,
  "template" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_expense_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recurring_expenses_tenant_id_next_on_idx" ON "recurring_expenses" ("tenant_id", "next_on");

CREATE TABLE "fin_cleared" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "entry_id" VARCHAR(80) NOT NULL,
  "cleared_on" DATE NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "fin_cleared_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_cleared_tenant_id_entry_id_key" ON "fin_cleared" ("tenant_id", "entry_id");

ALTER TABLE "fin_categories" ADD COLUMN "budget_paise" BIGINT;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fin_ledgers', 'journals', 'journal_lines', 'recurring_expenses', 'fin_cleared'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
