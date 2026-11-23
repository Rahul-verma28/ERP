-- AHEAD Console: first schema (see prisma/schema.prisma)
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "console_role" AS ENUM ('admin', 'staff', 'sales', 'vendor', 'partner_owner', 'partner_staff');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "onboarded_by" AS ENUM ('website', 'team', 'sales', 'vendor', 'partner');

-- CreateEnum
CREATE TYPE "sub_status" AS ENUM ('incomplete', 'trialing', 'active', 'past_due', 'free', 'closed');

-- CreateTable
CREATE TABLE "console_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "password_hash" TEXT,
    "role" "console_role" NOT NULL,
    "partner_id" UUID,
    "status" "account_status" NOT NULL DEFAULT 'invited',
    "referral_code" TEXT,
    "mfa_secret" TEXT,
    "mfa_enabled_at" TIMESTAMPTZ,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "console_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "console_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "gstin" TEXT,
    "city" TEXT,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "monthly_paise" INTEGER,
    "yearly_paise" INTEGER,
    "limits" JSONB NOT NULL,
    "modules" TEXT[],
    "is_free" BOOLEAN NOT NULL DEFAULT false,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "coupons" (
    "code" TEXT NOT NULL,
    "percent_off" INTEGER,
    "amount_off_paise" INTEGER,
    "valid_until" TIMESTAMPTZ,
    "max_uses" INTEGER,
    "used" INTEGER NOT NULL DEFAULT 0,
    "plan_keys" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "deployment" TEXT NOT NULL DEFAULT 'cloud-dev',
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" TEXT,
    "state_code" TEXT,
    "industry_key" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "owner_email" TEXT NOT NULL,
    "owner_mobile" TEXT NOT NULL,
    "onboarded_by" "onboarded_by" NOT NULL DEFAULT 'website',
    "onboarded_by_id" UUID,
    "partner_id" UUID,
    "referral_code" TEXT,
    "provisioned_at" TIMESTAMPTZ,
    "owner_link_sent_at" TIMESTAMPTZ,
    "facts" JSONB NOT NULL DEFAULT '{}',
    "facts_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "business_id" UUID NOT NULL,
    "plan_key" TEXT NOT NULL,
    "status" "sub_status" NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'monthly',
    "trial_ends_at" TIMESTAMPTZ,
    "period_start" TIMESTAMPTZ,
    "period_end" TIMESTAMPTZ,
    "grace_ends_at" TIMESTAMPTZ,
    "extra_users" INTEGER NOT NULL DEFAULT 0,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ,
    "purge_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "module_overrides" (
    "business_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "until" TIMESTAMPTZ,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_overrides_pkey" PRIMARY KEY ("business_id","module_key")
);

-- CreateTable
CREATE TABLE "licences" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "status" "sub_status" NOT NULL,
    "plan_key" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "delivered_at" TIMESTAMPTZ,

    CONSTRAINT "licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ,
    "last_error" TEXT,
    "done_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "last_started_at" TIMESTAMPTZ,
    "last_finished_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "last_summary" TEXT,
    "locked_until" TIMESTAMPTZ,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "seen_calls" (
    "nonce" UUID NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seen_calls_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "console_users_email_key" ON "console_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "console_users_mobile_key" ON "console_users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "console_users_referral_code_key" ON "console_users"("referral_code");

-- CreateIndex
CREATE INDEX "console_users_partner_id_idx" ON "console_users"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "console_sessions_refresh_hash_key" ON "console_sessions"("refresh_hash");

-- CreateIndex
CREATE INDEX "console_sessions_user_id_idx" ON "console_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_links_token_hash_key" ON "account_links"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "businesses_partner_id_idx" ON "businesses"("partner_id");

-- CreateIndex
CREATE INDEX "businesses_onboarded_by_id_idx" ON "businesses"("onboarded_by_id");

-- CreateIndex
CREATE INDEX "licences_business_id_seq_idx" ON "licences"("business_id", "seq");

-- CreateIndex
CREATE INDEX "notes_business_id_idx" ON "notes"("business_id");

-- CreateIndex
CREATE INDEX "deliveries_done_at_next_attempt_at_idx" ON "deliveries"("done_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "deliveries_business_id_idx" ON "deliveries"("business_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "console_users" ADD CONSTRAINT "console_users_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "console_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "console_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_onboarded_by_id_fkey" FOREIGN KEY ("onboarded_by_id") REFERENCES "console_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "plans"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_overrides" ADD CONSTRAINT "module_overrides_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licences" ADD CONSTRAINT "licences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
