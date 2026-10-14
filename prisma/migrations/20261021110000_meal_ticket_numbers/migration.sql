-- Stable café ticket numbers (#916). Additive: one counter column and one table.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "mealTicketSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EventMealTicket" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventMealTicket_eventId_number_key" ON "EventMealTicket"("eventId", "number");

-- CreateIndex
CREATE INDEX "EventMealTicket_selectionId_cancelledAt_idx" ON "EventMealTicket"("selectionId", "cancelledAt");

-- AddForeignKey
ALTER TABLE "EventMealTicket" ADD CONSTRAINT "EventMealTicket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealTicket" ADD CONSTRAINT "EventMealTicket_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "EventMealSelection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one ticket per unit of every ACTIVE selection, numbered per event 1..n in a deterministic order
-- (selection createdAt, then id, then unit). Cancelled selections get no ticket: they are never exported, and the
-- counter only moves forward, so their units can never collide with a later number. Ids are derived from the
-- selection id and unit so the backfill is repeatable.
INSERT INTO "EventMealTicket" ("id", "eventId", "selectionId", "number")
SELECT 'mtk_' || md5(s."id" || ':' || u.unit::text), s."eventId", s."id",
       (row_number() OVER (PARTITION BY s."eventId" ORDER BY s."createdAt", s."id", u.unit))::integer
FROM "EventMealSelection" s
CROSS JOIN LATERAL generate_series(1, s."quantity") AS u(unit)
WHERE s."status" = 'ACTIVE';

UPDATE "Event" e
SET "mealTicketSeq" = t.max_number
FROM (SELECT "eventId", max("number") AS max_number FROM "EventMealTicket" GROUP BY "eventId") t
WHERE t."eventId" = e."id";
