-- Masters that can be made inactive: hidden from new choices, kept on old records
ALTER TABLE "price_lists" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "item_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "fin_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branches" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
