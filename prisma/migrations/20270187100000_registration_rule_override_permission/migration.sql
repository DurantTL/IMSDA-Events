-- Permission to send a staff-entered registration past a closed or full event, with a reason (#1510), and who sent a
-- staff-started registration themselves. Additive only: one enum value and one nullable column with a foreign key.
-- No existing row is read, moved or changed.

-- AlterEnum
ALTER TYPE "EventPermission" ADD VALUE 'OVERRIDE_REGISTRATION_RULES';

-- AlterTable
ALTER TABLE "StaffRegistrationDraft" ADD COLUMN "submittedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
