-- Simple event budget sheet (#1682). Additive: one new table for an event's cost lines. Drops no column or table, renames
-- nothing, and moves no data. Income and counts are read from registrations when the sheet is opened and are not stored here.

-- CreateTable
CREATE TABLE "EventBudgetCostLine" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventBudgetCostLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventBudgetCostLine_amount_check" CHECK ("amountCents" >= 0 AND "amountCents" <= 100000000),
    CONSTRAINT "EventBudgetCostLine_quantity_check" CHECK ("quantity" IS NULL OR ("quantity" >= 1 AND "quantity" <= 100000))
);

-- CreateIndex
CREATE INDEX "EventBudgetCostLine_eventId_createdAt_idx" ON "EventBudgetCostLine"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventBudgetCostLine" ADD CONSTRAINT "EventBudgetCostLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
