-- Optional club calendar with reminders (#1700). Additive: one outbox template key, a calendar item table, a per-club
-- reminder setting (no row means off, so nothing sends after deploy) and a once-per-item-and-date claim log.
-- Applying it in production is a human step.

-- CreateEnum
CREATE TYPE "ClubCalendarItemKind" AS ENUM ('MEETING', 'OUTING', 'DEADLINE');

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CLUB_CALENDAR_REMINDER';

-- CreateTable
CREATE TABLE "ClubCalendarItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ClubCalendarItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "location" TEXT,
    "notes" TEXT,
    "createdByAccountId" TEXT,
    "createdByUserId" TEXT,
    "updatedByAccountId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubCalendarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubCalendarReminderSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "daysBefore" INTEGER NOT NULL DEFAULT 2,
    "updatedByAccountId" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubCalendarReminderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubCalendarReminderLog" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemDate" VARCHAR(10) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubCalendarReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubCalendarItem_organizationId_date_idx" ON "ClubCalendarItem"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ClubCalendarReminderSetting_organizationId_key" ON "ClubCalendarReminderSetting"("organizationId");

-- CreateIndex
CREATE INDEX "ClubCalendarReminderLog_organizationId_idx" ON "ClubCalendarReminderLog"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubCalendarReminderLog_itemId_itemDate_key" ON "ClubCalendarReminderLog"("itemId", "itemDate");

-- AddForeignKey
ALTER TABLE "ClubCalendarItem" ADD CONSTRAINT "ClubCalendarItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubCalendarReminderSetting" ADD CONSTRAINT "ClubCalendarReminderSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubCalendarReminderLog" ADD CONSTRAINT "ClubCalendarReminderLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ClubCalendarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

