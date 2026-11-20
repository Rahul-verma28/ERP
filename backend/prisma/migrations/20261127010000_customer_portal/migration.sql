-- Customer portal: a business's customers sign in with their mobile number (OTP) or a link the
-- business sends, and see their bills, statement, requests and bookings.

ALTER TYPE "otp_purpose" ADD VALUE IF NOT EXISTS 'portal';

CREATE TABLE "portal_settings" (
  "tenant_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "slug" VARCHAR(40),
  "title" TEXT NOT NULL DEFAULT 'Your account',
  "intro" TEXT,
  "show_bills" BOOLEAN NOT NULL DEFAULT true,
  "show_quotes" BOOLEAN NOT NULL DEFAULT true,
  "allow_quote_reply" BOOLEAN NOT NULL DEFAULT true,
  "show_statement" BOOLEAN NOT NULL DEFAULT true,
  "show_requests" BOOLEAN NOT NULL DEFAULT true,
  "show_bookings" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("tenant_id")
);
CREATE UNIQUE INDEX "portal_settings_slug_key" ON "portal_settings" ("slug");

ALTER TABLE "contacts" ADD COLUMN "portal_seen_at" TIMESTAMPTZ;
ALTER TABLE "contacts" ADD COLUMN "portal_blocked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "portal_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_settings" USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON "portal_settings" TO app_user;
