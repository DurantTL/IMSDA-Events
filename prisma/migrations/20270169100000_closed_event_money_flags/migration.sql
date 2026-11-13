-- Money recorded while an event was Closed (#1515 follow-up): Square payments and refunds that arrive after the close are
-- recorded as usual and flagged here for the finance office. Additive only: one new table, nothing existing changes.

-- CreateTable
CREATE TABLE "ClosedEventMoneyFlag" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paymentId" TEXT,
    "refundId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "clearedByUserId" TEXT,
    "clearedByNameSnapshot" TEXT,
    "clearNote" TEXT,

    CONSTRAINT "ClosedEventMoneyFlag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClosedEventMoneyFlag_kind_check" CHECK ("kind" IN ('PAYMENT', 'REFUND')),
    CONSTRAINT "ClosedEventMoneyFlag_clear_check" CHECK (
        ("clearedAt" IS NULL AND "clearNote" IS NULL)
        OR ("clearedAt" IS NOT NULL AND "clearNote" IS NOT NULL AND char_length(btrim("clearNote")) BETWEEN 1 AND 500)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "ClosedEventMoneyFlag_paymentId_key" ON "ClosedEventMoneyFlag"("paymentId");
CREATE UNIQUE INDEX "ClosedEventMoneyFlag_refundId_key" ON "ClosedEventMoneyFlag"("refundId");
CREATE INDEX "ClosedEventMoneyFlag_eventId_clearedAt_idx" ON "ClosedEventMoneyFlag"("eventId", "clearedAt");

-- AddForeignKey
ALTER TABLE "ClosedEventMoneyFlag" ADD CONSTRAINT "ClosedEventMoneyFlag_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClosedEventMoneyFlag" ADD CONSTRAINT "ClosedEventMoneyFlag_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClosedEventMoneyFlag" ADD CONSTRAINT "ClosedEventMoneyFlag_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
