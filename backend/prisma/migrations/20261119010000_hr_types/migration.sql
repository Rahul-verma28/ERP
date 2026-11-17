-- Holiday and loan types now come from the HR setup lists (up to 60 characters)
ALTER TABLE "hr_loans" ALTER COLUMN "kind" TYPE VARCHAR(60), ALTER COLUMN "kind" SET DEFAULT 'Salary advance';
ALTER TABLE "holidays" ALTER COLUMN "kind" TYPE VARCHAR(60), ALTER COLUMN "kind" SET DEFAULT 'Festival';
