-- Merchandise order staff actions (#148): mark paid, comp, cancel.
-- The new enum values are not used in this migration (ALTER TYPE ... ADD VALUE
-- cannot be used in the transaction that adds it).

-- AlterEnum
ALTER TYPE "MerchandiseOrderStatus" ADD VALUE IF NOT EXISTS 'COMPED';

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE IF NOT EXISTS 'MERCHANDISE_RECEIPT';

-- CreateEnum
CREATE TYPE "MerchandiseOrderAction" AS ENUM ('MARK_PAID', 'COMP', 'CANCEL');

-- AlterTable
ALTER TABLE "MerchandiseOrder" ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "receiptNumber" TEXT;

-- AlterTable
ALTER TABLE "MerchandiseOrderStatusChange" ADD COLUMN "action" "MerchandiseOrderAction",
ADD COLUMN "amountCents" INTEGER,
ADD COLUMN "clientRequestId" TEXT,
ADD COLUMN "paymentMethod" "PaymentMethod",
ADD COLUMN "paymentReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOrder_eventId_receiptNumber_key" ON "MerchandiseOrder"("eventId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOrderStatusChange_orderId_clientRequestId_key" ON "MerchandiseOrderStatusChange"("orderId", "clientRequestId");
