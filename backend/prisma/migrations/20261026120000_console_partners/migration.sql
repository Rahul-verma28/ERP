-- Console rework: partner organisations and referral codes.
-- A partner brings its own clients and is billed by AHEAD every month (wholesale = list price
-- minus the partner's discount). Partner people are Console members linked to their partner.
-- Platform table (no RLS): only the Console reads and writes it.

CREATE TABLE "partners" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "mobile" VARCHAR(15) NOT NULL,
  "gstin" VARCHAR(15),
  "state_code" CHAR(2),
  -- Wholesale discount on AHEAD's list price, in basis points (2500 = 25%)
  "discount_bp" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "partners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partners_status_check" CHECK ("status" IN ('active', 'paused')),
  CONSTRAINT "partners_discount_check" CHECK ("discount_bp" BETWEEN 0 AND 9000)
);
CREATE UNIQUE INDEX "partners_name_key" ON "partners" (lower("name"));

ALTER TABLE "platform_members" ADD COLUMN "partner_id" UUID;
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_partner_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id");
CREATE INDEX "platform_members_partner_idx" ON "platform_members" ("partner_id");

-- Vendors and salespeople share a link / code; signups with it are credited to them
ALTER TABLE "platform_members" ADD COLUMN "referral_code" VARCHAR(20);
CREATE UNIQUE INDEX "platform_members_referral_code_key" ON "platform_members" ("referral_code");

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_partner_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id");
