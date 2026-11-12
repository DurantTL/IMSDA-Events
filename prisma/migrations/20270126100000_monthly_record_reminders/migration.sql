-- Automatic Monthly Record reminders (#1895). Additive: two outbox template keys, a once-per-club-per-month log and a per-club-year on/off switch.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'MONTHLY_RECORD_REMINDER';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'MONTHLY_RECORD_REMINDER_SUMMARY';

-- CreateTable
CREATE TABLE "MonthlyRecordReminderLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportMonth" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyRecordReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyRecordReminderSetting" (
    "clubYear" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyRecordReminderSetting_pkey" PRIMARY KEY ("clubYear")
);

-- CreateIndex
CREATE INDEX "MonthlyRecordReminderLog_reportMonth_idx" ON "MonthlyRecordReminderLog"("reportMonth");

-- CreateIndex
CREATE INDEX "MonthlyRecordReminderLog_sentAt_idx" ON "MonthlyRecordReminderLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRecordReminderLog_organizationId_reportMonth_key" ON "MonthlyRecordReminderLog"("organizationId", "reportMonth");
