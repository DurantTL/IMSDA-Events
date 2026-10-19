-- Re-inviting after a decline (#1027). A declined person gets a NEW invitation row (a new single-use link); the old row stays as
-- history with its declined registration and is marked superseded. The one-invitation-per-address rule therefore applies to the
-- rows that are not superseded, so the plain unique key is replaced by a partial unique index. Existing rows are all live.

-- AlterTable
ALTER TABLE "StaffInvitation" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- DropIndex
DROP INDEX "StaffInvitation_eventId_email_key";

-- CreateIndex
CREATE INDEX "StaffInvitation_eventId_email_idx" ON "StaffInvitation"("eventId", "email");

-- CreateIndex (partial: only an invitation that has not been superseded holds its address)
CREATE UNIQUE INDEX "StaffInvitation_one_live_per_email" ON "StaffInvitation"("eventId", "email") WHERE "supersededAt" IS NULL;

-- Only a person who registered and was declined can have been replaced.
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_superseded_declined_check" CHECK ("supersededAt" IS NULL OR "approval" = 'DECLINED');
