-- Stable café ticket numbers (#916). Additive: one sequence and one table. Numbers come from the sequence
-- (`nextval`, non-transactional), so no event-wide row is ever written when a meal selection is made.

-- CreateSequence
CREATE SEQUENCE "EventMealTicket_number_seq" AS INTEGER;

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
-- sequence only moves forward, so their units can never collide with a later number. Ids are derived from the
-- selection id and unit so the backfill is repeatable.
INSERT INTO "EventMealTicket" ("id", "eventId", "selectionId", "number")
SELECT 'mtk_' || md5(s."id" || ':' || u.unit::text), s."eventId", s."id",
       (row_number() OVER (PARTITION BY s."eventId" ORDER BY s."createdAt", s."id", u.unit))::integer
FROM "EventMealSelection" s
CROSS JOIN LATERAL generate_series(1, s."quantity") AS u(unit)
WHERE s."status" = 'ACTIVE';

-- Start the sequence past the largest backfilled number (the backfill numbers per event, so the global maximum is
-- above every event's), so a new number can never collide with a backfilled one in any event.
SELECT setval('"EventMealTicket_number_seq"', COALESCE((SELECT max("number") FROM "EventMealTicket"), 0) + 1, false);
