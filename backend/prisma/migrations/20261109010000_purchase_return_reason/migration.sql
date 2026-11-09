-- Why goods went back on a purchase return
ALTER TABLE "purchase_documents" ADD COLUMN "return_reason" VARCHAR(40);
