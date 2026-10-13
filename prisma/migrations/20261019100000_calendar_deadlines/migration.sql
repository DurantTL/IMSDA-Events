-- Deadline reminders (#910): a Deadline type for calendar entries, and one
-- reminder batch per deadline and reminder point that waits for staff approval.
-- Additive: two new enum values, one new enum, one new table.

ALTER TYPE "CalendarEntryType" ADD VALUE 'DEADLINE';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'DEADLINE_REMINDER';

CREATE TYPE "DeadlineReminderStatus" AS ENUM ('PENDING', 'SENT', 'WITHDRAWN', 'DISMISSED');

CREATE TABLE "DeadlineReminderBatch" (
    "id" TEXT NOT NULL,
    "calendarEntryId" TEXT,
    "daysBefore" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" TEXT NOT NULL,
    "linkUrl" TEXT,
    "status" "DeadlineReminderStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "recipientCount" INTEGER,
    "optedOutCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineReminderBatch_pkey" PRIMARY KEY ("id"),
    -- The reminder points are 14 and 2 days before the due date.
    CONSTRAINT "DeadlineReminderBatch_daysBefore_check" CHECK ("daysBefore" IN (14, 2))
);

-- A deadline and reminder point are never prepared twice.
CREATE UNIQUE INDEX "DeadlineReminderBatch_calendarEntryId_daysBefore_key" ON "DeadlineReminderBatch"("calendarEntryId", "daysBefore");

CREATE INDEX "DeadlineReminderBatch_status_dueOn_idx" ON "DeadlineReminderBatch"("status", "dueOn");

ALTER TABLE "DeadlineReminderBatch" ADD CONSTRAINT "DeadlineReminderBatch_calendarEntryId_fkey" FOREIGN KEY ("calendarEntryId") REFERENCES "CalendarEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
