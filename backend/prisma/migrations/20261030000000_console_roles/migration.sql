-- Console Phase C: an Admin can edit a built-in Console role's permissions. Once edited, the
-- seed no longer resets that role to the code defaults ("Reset to default" clears this).
ALTER TABLE "roles" ADD COLUMN "customized_at" TIMESTAMPTZ;
