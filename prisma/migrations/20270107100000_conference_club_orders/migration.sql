-- Conference club orders (#1688): a club orders conference-supplied patches and pins from its Orders tab; the order goes to the youth
-- department and, once filled, is billed to the club's sponsoring church on a hidden per-club-year billing event. Additive: new
-- columns have defaults, two new tables, one new invoice version basis. Nothing existing changes meaning.

-- CreateEnum
CREATE TYPE "ClubSupplier" AS ENUM ('ADVENTSOURCE', 'CONFERENCE');

-- CreateEnum
CREATE TYPE "ConferenceClubOrderStatus" AS ENUM ('SUBMITTED', 'FILLED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "InvoiceVersionBasis" ADD VALUE 'CLUB_ORDERS';

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CONFERENCE_CLUB_ORDER_SUBMITTED';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'CONFERENCE_CLUB_ORDER_CONFIRMATION';

-- AlterTable
ALTER TABLE "ClubSupplyItem" ADD COLUMN     "supplier" "ClubSupplier" NOT NULL DEFAULT 'ADVENTSOURCE',
ADD COLUMN     "unitPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isBillingContainer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "conferenceOrdersEmail" TEXT;

-- CreateTable
CREATE TABLE "ConferenceClubOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "status" "ConferenceClubOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "patchesToExchange" INTEGER NOT NULL DEFAULT 0,
    "itemsTotalCents" INTEGER NOT NULL,
    "postageCents" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByAccountId" TEXT,
    "submittedByUserId" TEXT,
    "filledAt" TIMESTAMP(3),
    "filledByUserId" TEXT,
    "addedToStock" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cancelledByAccountId" TEXT,
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceClubOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceClubOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConferenceClubOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConferenceClubOrder_organizationId_status_idx" ON "ConferenceClubOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ConferenceClubOrder_churchId_eventId_status_idx" ON "ConferenceClubOrder"("churchId", "eventId", "status");

-- CreateIndex
CREATE INDEX "ConferenceClubOrder_status_submittedAt_idx" ON "ConferenceClubOrder"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ConferenceClubOrderLine_itemId_idx" ON "ConferenceClubOrderLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceClubOrderLine_orderId_itemId_key" ON "ConferenceClubOrderLine"("orderId", "itemId");

-- AddForeignKey
ALTER TABLE "ConferenceClubOrder" ADD CONSTRAINT "ConferenceClubOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceClubOrder" ADD CONSTRAINT "ConferenceClubOrder_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceClubOrder" ADD CONSTRAINT "ConferenceClubOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceClubOrderLine" ADD CONSTRAINT "ConferenceClubOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ConferenceClubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceClubOrderLine" ADD CONSTRAINT "ConferenceClubOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ClubSupplyItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Catalog: only a conference-supplied item has a unit price, and never a negative one.
ALTER TABLE "ClubSupplyItem" ADD CONSTRAINT "ClubSupplyItem_conference_price_check"
  CHECK ("unitPriceCents" IS NULL OR ("supplier"::text = 'CONFERENCE' AND "unitPriceCents" >= 0));

-- Orders: whole, positive counts and non-negative money.
ALTER TABLE "ConferenceClubOrder" ADD CONSTRAINT "ConferenceClubOrder_amounts_check"
  CHECK ("patchesToExchange" >= 0 AND "itemsTotalCents" >= 0 AND ("postageCents" IS NULL OR "postageCents" >= 0));
ALTER TABLE "ConferenceClubOrderLine" ADD CONSTRAINT "ConferenceClubOrderLine_amounts_check"
  CHECK ("quantity" > 0 AND "unitPriceCents" >= 0);

-- An invoice version with no reconciliation behind it is a church promo code invoice (#399) or a conference club orders invoice (#1688).
-- (The enum is compared as text so this statement does not need the new value to be committed first.)
ALTER TABLE "InvoiceVersion" DROP CONSTRAINT "InvoiceVersion_reconciliation_required";
ALTER TABLE "InvoiceVersion" ADD CONSTRAINT "InvoiceVersion_reconciliation_required"
  CHECK ("reconciliationVersionId" IS NOT NULL OR "basis"::text IN ('CHURCH_PROMO_CODES', 'CLUB_ORDERS'));
