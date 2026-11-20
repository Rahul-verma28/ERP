-- An invitation can be for an HR employee: accepting it links the new login to that employee record
ALTER TABLE "invitations" ADD COLUMN "employee_id" UUID;
