-- Several calendar items can link to one registration event (#1086). Additive: existing links are unchanged.

-- DropIndex
DROP INDEX "CalendarEntry_linkedEventId_key";

-- CreateIndex
CREATE INDEX "CalendarEntry_linkedEventId_idx" ON "CalendarEntry"("linkedEventId");
