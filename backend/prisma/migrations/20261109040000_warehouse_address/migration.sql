-- Where a warehouse is and how to reach it
ALTER TABLE "stock_locations" ADD COLUMN "address" TEXT, ADD COLUMN "city" TEXT, ADD COLUMN "zip_code" VARCHAR(10), ADD COLUMN "phone" VARCHAR(20), ADD COLUMN "email" TEXT;
