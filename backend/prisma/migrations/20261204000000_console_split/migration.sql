-- The AHEAD Console moved to its own service and database (console-api). This ERP keeps only
-- what a business uses and the licence the Console signs; every plan, price, partner, Console
-- member and billing table goes. See docs/architecture/console-erp-split.md.

-- Console roles and Console login links have no place in the ERP any more
DELETE FROM "role_field_access" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "layer" <> 'tenant');
DELETE FROM "role_permissions" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "layer" <> 'tenant');
DELETE FROM "platform_members";
DELETE FROM "roles" WHERE "layer" <> 'tenant';
DELETE FROM "permissions" WHERE "module_key" = 'platform';
DELETE FROM "access_links" WHERE "kind" = 'console_member';

-- AlterEnum
CREATE TYPE "role_layer_new" AS ENUM ('tenant');
ALTER TABLE "roles" ALTER COLUMN "layer" TYPE "role_layer_new" USING ("layer"::text::"role_layer_new");
ALTER TYPE "role_layer" RENAME TO "role_layer_old";
ALTER TYPE "role_layer_new" RENAME TO "role_layer";
DROP TYPE "role_layer_old";

-- AlterEnum
CREATE TYPE "access_link_kind_new" AS ENUM ('client_owner');
ALTER TABLE "access_links" ALTER COLUMN "kind" TYPE "access_link_kind_new" USING ("kind"::text::"access_link_kind_new");
ALTER TYPE "access_link_kind" RENAME TO "access_link_kind_old";
ALTER TYPE "access_link_kind_new" RENAME TO "access_link_kind";
DROP TYPE "access_link_kind_old";

-- DropForeignKey
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_partner_fkey";

-- DropForeignKey
ALTER TABLE "platform_members" DROP CONSTRAINT "platform_members_user_id_fkey";

-- DropForeignKey
ALTER TABLE "platform_members" DROP CONSTRAINT "platform_members_role_id_fkey";

-- DropForeignKey
ALTER TABLE "platform_members" DROP CONSTRAINT "platform_members_partner_fkey";

-- DropForeignKey
ALTER TABLE "platform_payments" DROP CONSTRAINT "platform_payments_order_id_fkey";

-- DropForeignKey
ALTER TABLE "platform_invoices" DROP CONSTRAINT "platform_invoices_order_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_acquisitions" DROP CONSTRAINT "tenant_acquisitions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "plan_modules" DROP CONSTRAINT "plan_modules_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_items" DROP CONSTRAINT "subscription_items_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "scheduled_changes" DROP CONSTRAINT "scheduled_changes_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "console_followups" DROP CONSTRAINT "console_followups_prospect_fkey";

-- DropForeignKey
ALTER TABLE "console_notes" DROP CONSTRAINT "console_notes_prospect_fkey";

-- DropIndex
DROP INDEX "tenants_partner_id_idx";

-- DropIndex
DROP INDEX "tenants_source_idx";

-- AlterTable
ALTER TABLE "user_sessions" DROP COLUMN "workspace";

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "billing_owner",
DROP COLUMN "is_internal",
DROP COLUMN "needs_seat_choice",
DROP COLUMN "onboarding_type",
DROP COLUMN "partner_id",
DROP COLUMN "source";

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "customized_at";

-- DropTable
DROP TABLE IF EXISTS "platform_members" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "partners" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "grace_periods" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "platform_orders" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "platform_payments" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "platform_invoices" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "platform_credit_notes" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "webhook_events" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "console_applications" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "platform_sequences" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "tenant_acquisitions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "trial_registry" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "config_values" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "modules" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "plans" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "plan_modules" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "prices" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "coupons" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "plan_drafts" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "tenant_module_overrides" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "subscriptions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "subscription_items" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "scheduled_changes" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "credit_balances" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "console_prospects" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "console_followups" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "console_notes" CASCADE;

-- DropEnum
DROP TYPE "tenant_source";

-- DropEnum
DROP TYPE "onboarding_type";

-- DropEnum
DROP TYPE "acquired_by_type";

-- DropEnum
DROP TYPE "acquisition_method";

-- DropEnum
DROP TYPE "workspace";

-- DropEnum
DROP TYPE "billing_owner";

-- DropEnum
DROP TYPE "price_item_type";

-- DropEnum
DROP TYPE "billing_cycle";

-- DropEnum
DROP TYPE "coupon_type";

-- DropEnum
DROP TYPE "extension_kind";

-- DropEnum
DROP TYPE "platform_order_status";

-- DropEnum
DROP TYPE "platform_payment_method";
