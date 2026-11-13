-- Reminders for unsubmitted club registrations (#164). Additive: one outbox template key, a per-event policy (no row
-- means off, so nothing sends after deploy) and a once-per-draft-and-attempt claim log. Applying it in production is a human step.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CLUB_DRAFT_REMINDER';

-- CreateTable
CREATE TABLE "ClubDraftReminderPolicy" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstAfterDays" INTEGER NOT NULL DEFAULT 2,
    "repeatEveryDays" INTEGER NOT NULL DEFAULT 3,
    "maxReminders" INTEGER NOT NULL DEFAULT 2,
    "staleAfterDays" INTEGER NOT NULL DEFAULT 30,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubDraftReminderPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubDraftReminderLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "draftKey" TEXT NOT NULL DEFAULT '',
    "attempt" INTEGER NOT NULL,
    "recipients" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "ClubDraftReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubDraftReminderPolicy_eventId_key" ON "ClubDraftReminderPolicy"("eventId");

-- CreateIndex
CREATE INDEX "ClubDraftReminderLog_eventId_sentAt_idx" ON "ClubDraftReminderLog"("eventId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubDraftReminderLog_draftId_attempt_key" ON "ClubDraftReminderLog"("draftId", "attempt");

-- AddForeignKey
ALTER TABLE "ClubDraftReminderPolicy" ADD CONSTRAINT "ClubDraftReminderPolicy_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubDraftReminderPolicy" ADD CONSTRAINT "ClubDraftReminderPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubDraftReminderLog" ADD CONSTRAINT "ClubDraftReminderLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubDraftReminderLog" ADD CONSTRAINT "ClubDraftReminderLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
