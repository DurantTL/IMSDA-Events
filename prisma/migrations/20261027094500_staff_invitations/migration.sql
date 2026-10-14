-- Personal staff invitations (#804). Additive only: two enums and one new table, with its keys and indexes. Nothing existing
-- is changed. An invitation is one row per invited email per event (the unique key), carries the group (Staff, Pastor,
-- Volunteer) and the office's approval decision on the registration made through it. The link itself is not stored: it is
-- derived from the row's id and linkVersion.

-- CreateEnum
CREATE TYPE "StaffInvitationGroup" AS ENUM ('STAFF', 'PASTOR', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "StaffInvitationApproval" AS ENUM ('WAITING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "group" "StaffInvitationGroup" NOT NULL,
    "linkVersion" INTEGER NOT NULL DEFAULT 1,
    "importBatchId" TEXT,
    "createdByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "registrationId" TEXT,
    "registeredAt" TIMESTAMP(3),
    "approval" "StaffInvitationApproval",
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "needsHousing" BOOLEAN,
    "housingNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_registrationId_key" ON "StaffInvitation"("registrationId");

-- CreateIndex
CREATE INDEX "StaffInvitation_eventId_group_idx" ON "StaffInvitation"("eventId", "group");

-- CreateIndex
CREATE INDEX "StaffInvitation_eventId_approval_idx" ON "StaffInvitation"("eventId", "approval");

-- CreateIndex
CREATE INDEX "StaffInvitation_lastMessageId_idx" ON "StaffInvitation"("lastMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_eventId_email_key" ON "StaffInvitation"("eventId", "email");

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES "MessageOutbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The address is always kept normalized, the link version starts at 1, and an approval exists exactly when the invitation was
-- used to register.
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_email_normalized_check" CHECK ("email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 254);
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_link_version_check" CHECK ("linkVersion" >= 1);
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_approval_registered_check" CHECK (("approval" IS NULL) = ("registeredAt" IS NULL));
