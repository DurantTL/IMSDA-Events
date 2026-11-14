-- Baptism follow-up (#1680): staff mark a name followed up and may keep a short note with it. The note is staff's own text, kept on the row, never emailed and never copied into an audit entry.
-- Additive: four nullable columns (who marked it is a staff user or an Area Coordinator's account, never both), two indexes and two foreign keys on "BaptismFollowUp". Applying it in production is a human step.

-- AlterTable
ALTER TABLE "BaptismFollowUp" ADD COLUMN     "followUpNote" TEXT,
ADD COLUMN     "followedUpAt" TIMESTAMP(3),
ADD COLUMN     "followedUpByAttendeeAccountId" TEXT,
ADD COLUMN     "followedUpByUserId" TEXT;

-- CreateIndex
CREATE INDEX "BaptismFollowUp_followedUpByUserId_idx" ON "BaptismFollowUp"("followedUpByUserId");

-- CreateIndex
CREATE INDEX "BaptismFollowUp_followedUpByAttendeeAccountId_idx" ON "BaptismFollowUp"("followedUpByAttendeeAccountId");

-- AddForeignKey
ALTER TABLE "BaptismFollowUp" ADD CONSTRAINT "BaptismFollowUp_followedUpByUserId_fkey" FOREIGN KEY ("followedUpByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaptismFollowUp" ADD CONSTRAINT "BaptismFollowUp_followedUpByAttendeeAccountId_fkey" FOREIGN KEY ("followedUpByAttendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
