-- Credit and debit notes print the date of the invoice they are against (Rule 53(1A) CGST Rules)
ALTER TABLE "sales_documents" ADD COLUMN "source_date" DATE;
UPDATE "sales_documents" n SET "source_date" = i."issue_date"
FROM "sales_documents" i WHERE n."source_id" = i."id" AND n."kind" IN ('credit_note', 'debit_note') AND n."source_date" IS NULL;
