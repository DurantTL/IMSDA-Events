-- CreateEnum
CREATE TYPE "ScholarshipContributionMethod" AS ENUM ('CASH', 'CHECK', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "ScholarshipFund" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScholarshipFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScholarshipContribution" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "organizationId" TEXT,
    "sponsorName" TEXT NOT NULL,
    "sponsorKey" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "method" "ScholarshipContributionMethod" NOT NULL,
    "note" TEXT,
    "reversesContributionId" TEXT,
    "createdByUserId" TEXT,
    "createdByNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScholarshipContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScholarshipAward" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "pledged" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "sponsorName" TEXT,
    "sponsorKey" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScholarshipAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScholarshipFund_eventId_key" ON "ScholarshipFund"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ScholarshipFund_id_eventId_key" ON "ScholarshipFund"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ScholarshipContribution_reversesContributionId_key" ON "ScholarshipContribution"("reversesContributionId");

-- CreateIndex
CREATE INDEX "ScholarshipContribution_fundId_receivedOn_idx" ON "ScholarshipContribution"("fundId", "receivedOn");

-- CreateIndex
CREATE INDEX "ScholarshipContribution_fundId_sponsorKey_idx" ON "ScholarshipContribution"("fundId", "sponsorKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScholarshipAward_adjustmentId_key" ON "ScholarshipAward"("adjustmentId");

-- CreateIndex
CREATE INDEX "ScholarshipAward_fundId_sponsorKey_idx" ON "ScholarshipAward"("fundId", "sponsorKey");

-- CreateIndex
CREATE INDEX "ScholarshipAward_registrationId_idx" ON "ScholarshipAward"("registrationId");

-- AddForeignKey
ALTER TABLE "ScholarshipFund" ADD CONSTRAINT "ScholarshipFund_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipContribution" ADD CONSTRAINT "ScholarshipContribution_fundId_eventId_fkey" FOREIGN KEY ("fundId", "eventId") REFERENCES "ScholarshipFund"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipContribution" ADD CONSTRAINT "ScholarshipContribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipContribution" ADD CONSTRAINT "ScholarshipContribution_reversesContributionId_fkey" FOREIGN KEY ("reversesContributionId") REFERENCES "ScholarshipContribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_fundId_eventId_fkey" FOREIGN KEY ("fundId", "eventId") REFERENCES "ScholarshipFund"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "RegistrationAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Money rules the application also enforces (#398): amounts are whole cents, a contribution adds money and its
-- reversal removes it, an award is positive, a pledge names who pledged it, and only a pledge can be settled.
ALTER TABLE "ScholarshipContribution" ADD CONSTRAINT "ScholarshipContribution_amount_matches_kind"
  CHECK (("reversesContributionId" IS NULL AND "amountCents" > 0) OR ("reversesContributionId" IS NOT NULL AND "amountCents" < 0));
ALTER TABLE "ScholarshipContribution" ADD CONSTRAINT "ScholarshipContribution_amount_limit"
  CHECK ("amountCents" BETWEEN -100000000 AND 100000000);
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_amount_positive"
  CHECK ("amountCents" > 0 AND "amountCents" <= 100000000);
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_pledge_names_sponsor"
  CHECK (NOT "pledged" OR "sponsorKey" IS NOT NULL);
ALTER TABLE "ScholarshipAward" ADD CONSTRAINT "ScholarshipAward_settled_only_if_pledged"
  CHECK ("settledAt" IS NULL OR "pledged");
