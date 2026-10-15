-- Calendar items and registration events are one thing (#445). Additive only: five nullable columns, one new table.
-- The link is a nullable unique column that a feed refresh never writes, so it survives every import; deleting the event
-- clears it (ON DELETE SET NULL) and the item shows on its own again.

-- AlterTable
ALTER TABLE "CalendarEntry" ADD COLUMN     "keptEndsOn" TEXT,
ADD COLUMN     "keptStartsOn" TEXT,
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "linkedByUserId" TEXT,
ADD COLUMN     "linkedEventId" TEXT;

-- CreateTable
CREATE TABLE "CalendarEventMatchDismissal" (
    "calendarEntryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "dismissedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventMatchDismissal_pkey" PRIMARY KEY ("calendarEntryId","eventId")
);

-- CreateIndex
CREATE INDEX "CalendarEventMatchDismissal_eventId_idx" ON "CalendarEventMatchDismissal"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEntry_linkedEventId_key" ON "CalendarEntry"("linkedEventId");

-- AddForeignKey
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_linkedEventId_fkey" FOREIGN KEY ("linkedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventMatchDismissal" ADD CONSTRAINT "CalendarEventMatchDismissal_calendarEntryId_fkey" FOREIGN KEY ("calendarEntryId") REFERENCES "CalendarEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventMatchDismissal" ADD CONSTRAINT "CalendarEventMatchDismissal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The two kept dates are chosen together or not at all.
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_kept_dates_paired_check"
  CHECK (("keptStartsOn" IS NULL) = ("keptEndsOn" IS NULL));
