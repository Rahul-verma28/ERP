-- HR, round two: leave type descriptions, and who approved announcements, events and documents.
ALTER TABLE "leave_types" ADD COLUMN "description" TEXT;
ALTER TABLE "hr_posts" ADD COLUMN "approved_by" UUID;
ALTER TABLE "hr_posts" ADD COLUMN "approved_at" TIMESTAMPTZ;
