-- Money recorded while an event was Closed (#1515 follow-up): Square payments and refunds that arrive after the close are
-- recorded as usual and listed here for the finance office. Additive only: one new table, nothing existing changes.

-- CreateTable
CREATE TABLE "ClosedEventMoneyReview" (
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

    CONSTRAINT "ClosedEventMoneyReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClosedEventMoneyReview_kind_check" CHECK ("kind" IN ('PAYMENT', 'REFUND')),
    CONSTRAINT "ClosedEventMoneyReview_clear_check" CHECK (
        ("clearedAt" IS NULL AND "clearNote" IS NULL AND "clearedByNameSnapshot" IS NULL)
        OR ("clearedAt" IS NOT NULL AND "clearNote" IS NOT NULL AND "clearedByNameSnapshot" IS NOT NULL AND char_length(btrim("clearNote")) BETWEEN 1 AND 500)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "ClosedEventMoneyReview_paymentId_key" ON "ClosedEventMoneyReview"("paymentId");
CREATE UNIQUE INDEX "ClosedEventMoneyReview_refundId_key" ON "ClosedEventMoneyReview"("refundId");
CREATE INDEX "ClosedEventMoneyReview_eventId_clearedAt_idx" ON "ClosedEventMoneyReview"("eventId", "clearedAt");

-- AddForeignKey
ALTER TABLE "ClosedEventMoneyReview" ADD CONSTRAINT "ClosedEventMoneyReview_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClosedEventMoneyReview" ADD CONSTRAINT "ClosedEventMoneyReview_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClosedEventMoneyReview" ADD CONSTRAINT "ClosedEventMoneyReview_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
