-- Console Phase G: people apply on the website to become a vendor or a partner; an Admin
-- approves (creates the partner or vendor and a login link) or turns it down. Platform table.
CREATE TABLE "console_applications" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "email" TEXT NOT NULL,
  "mobile" TEXT NOT NULL,
  "city" TEXT,
  "state_code" CHAR(2),
  "gstin" VARCHAR(15),
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ,
  "decision_note" TEXT,
  "result_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "console_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "console_applications_status_created_at_idx" ON "console_applications" ("status", "created_at");
CREATE INDEX "console_applications_email_idx" ON "console_applications" ("email");
