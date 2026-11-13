-- Staff-started registration drafts (#1510): answers staff enter for someone by phone, on paper or at the door, handed to the
-- registrant through one private link. Holds no payment. The new enum value is only added here; nothing in this migration uses it.

-- CreateEnum
CREATE TYPE "StaffRegistrationDraftSource" AS ENUM ('PHONE', 'PAPER', 'WALK_IN');

-- CreateEnum
CREATE TYPE "StaffRegistrationDraftStatus" AS ENUM ('OPEN', 'HANDED_OFF', 'SUBMITTED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'STAFF_REGISTRATION_DRAFT_LINK';

-- CreateTable
CREATE TABLE "StaffRegistrationDraft" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "source" "StaffRegistrationDraftSource" NOT NULL,
    "status" "StaffRegistrationDraftStatus" NOT NULL DEFAULT 'OPEN',
    "responses" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "handOffTokenHash" TEXT,
    "handOffExpiresAt" TIMESTAMP(3),
    "handedOffAt" TIMESTAMP(3),
    "handedOffByUserId" TEXT,
    "handOffMessageId" TEXT,
    "registrationId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRegistrationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegistrationDraft_handOffTokenHash_key" ON "StaffRegistrationDraft"("handOffTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegistrationDraft_handOffMessageId_key" ON "StaffRegistrationDraft"("handOffMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegistrationDraft_registrationId_key" ON "StaffRegistrationDraft"("registrationId");

-- CreateIndex
CREATE INDEX "StaffRegistrationDraft_eventId_status_updatedAt_idx" ON "StaffRegistrationDraft"("eventId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "RegistrationFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_handedOffByUserId_fkey" FOREIGN KEY ("handedOffByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegistrationDraft" ADD CONSTRAINT "StaffRegistrationDraft_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

