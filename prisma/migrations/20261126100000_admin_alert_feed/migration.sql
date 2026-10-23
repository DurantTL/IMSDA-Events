-- CreateTable
CREATE TABLE "AdminAlertFeedItem" (
    "id" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "href" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlertFeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlertFeedReceipt" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlertFeedReceipt_pkey" PRIMARY KEY ("itemId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminAlertFeedItem_occurrenceKey_key" ON "AdminAlertFeedItem"("occurrenceKey");

-- CreateIndex
CREATE INDEX "AdminAlertFeedItem_occurredAt_idx" ON "AdminAlertFeedItem"("occurredAt");

-- CreateIndex
CREATE INDEX "AdminAlertFeedReceipt_userId_idx" ON "AdminAlertFeedReceipt"("userId");

-- AddForeignKey
ALTER TABLE "AdminAlertFeedReceipt" ADD CONSTRAINT "AdminAlertFeedReceipt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AdminAlertFeedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAlertFeedReceipt" ADD CONSTRAINT "AdminAlertFeedReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
