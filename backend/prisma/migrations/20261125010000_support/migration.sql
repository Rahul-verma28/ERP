-- Customer Service: tickets with a conversation (replies, internal notes, events), SLA timers,
-- warranty lookup, customer ratings, a knowledge base of articles and saved replies, and a public
-- form where customers raise a request and follow it without logging in.

CREATE TABLE "support_settings" (
  "tenant_id" UUID NOT NULL,
  "form_enabled" BOOLEAN NOT NULL DEFAULT false, "slug" VARCHAR(40), "title" TEXT NOT NULL DEFAULT 'Raise a request', "intro" TEXT,
  "categories" JSONB NOT NULL DEFAULT '[]', "sla" JSONB NOT NULL DEFAULT '{}',
  "warranty_months" INTEGER NOT NULL DEFAULT 12, "auto_assign" VARCHAR(12) NOT NULL DEFAULT 'none', "last_assigned_id" UUID,
  "ask_rating" BOOLEAN NOT NULL DEFAULT true, "auto_close_days" INTEGER NOT NULL DEFAULT 7,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "support_settings_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "support_settings_warranty_check" CHECK ("warranty_months" BETWEEN 0 AND 120),
  CONSTRAINT "support_settings_close_check" CHECK ("auto_close_days" BETWEEN 0 AND 90)
);
CREATE UNIQUE INDEX "support_settings_slug_key" ON "support_settings" ("slug");

CREATE TABLE "support_tickets" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" VARCHAR(20) NOT NULL,
  "subject" TEXT NOT NULL, "description" TEXT,
  "contact_id" UUID, "guest_name" TEXT, "guest_phone" VARCHAR(15), "guest_email" TEXT,
  "channel" VARCHAR(12) NOT NULL DEFAULT 'phone', "category" VARCHAR(30) NOT NULL DEFAULT 'other',
  "priority" VARCHAR(8) NOT NULL DEFAULT 'medium', "status" VARCHAR(12) NOT NULL DEFAULT 'new',
  "assignee_id" UUID, "labels" TEXT[] NOT NULL DEFAULT '{}',
  "invoice_id" UUID, "item_id" UUID, "serial" VARCHAR(60),
  "first_response_due" TIMESTAMPTZ, "resolve_due" TIMESTAMPTZ,
  "first_response_at" TIMESTAMPTZ, "resolved_at" TIMESTAMPTZ, "closed_at" TIMESTAMPTZ, "reopened" INTEGER NOT NULL DEFAULT 0,
  "rating" SMALLINT, "feedback" TEXT, "public_token" VARCHAR(40) NOT NULL,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_tickets_who_check" CHECK ("contact_id" IS NOT NULL OR "guest_name" IS NOT NULL),
  CONSTRAINT "support_tickets_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
  CONSTRAINT "support_tickets_status_check" CHECK ("status" IN ('new', 'open', 'pending', 'on_hold', 'resolved', 'closed')),
  CONSTRAINT "support_tickets_priority_check" CHECK ("priority" IN ('low', 'medium', 'high', 'urgent'))
);
CREATE UNIQUE INDEX "support_tickets_tenant_id_number_key" ON "support_tickets" ("tenant_id", "number");
CREATE UNIQUE INDEX "support_tickets_public_token_key" ON "support_tickets" ("public_token");
CREATE INDEX "support_tickets_tenant_id_status_idx" ON "support_tickets" ("tenant_id", "status");
CREATE INDEX "support_tickets_tenant_id_contact_id_idx" ON "support_tickets" ("tenant_id", "contact_id");

CREATE TABLE "support_messages" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "ticket_id" UUID NOT NULL,
  "kind" VARCHAR(10) NOT NULL, "body" TEXT, "author_id" UUID, "author_name" TEXT, "meta" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_messages_ticket_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  CONSTRAINT "support_messages_kind_check" CHECK ("kind" IN ('reply', 'note', 'customer', 'event'))
);
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages" ("ticket_id", "created_at");

CREATE TABLE "kb_articles" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "category" VARCHAR(30), "tags" TEXT[] NOT NULL DEFAULT '{}', "kind" VARCHAR(8) NOT NULL DEFAULT 'article',
  "published" BOOLEAN NOT NULL DEFAULT true, "uses" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kb_articles_kind_check" CHECK ("kind" IN ('article', 'reply'))
);
CREATE INDEX "kb_articles_tenant_id_kind_idx" ON "kb_articles" ("tenant_id", "kind");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_settings', 'support_tickets', 'support_messages', 'kb_articles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
