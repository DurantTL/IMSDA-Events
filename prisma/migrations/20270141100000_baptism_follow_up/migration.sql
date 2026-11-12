-- Optional baptism follow-up (#1680). Additive: one new email template key and two new tables; nothing altered or dropped, no
-- data moved. It writes no EventModule row, so no existing event has the module on, and no notice is sent until a system
-- administrator turns the module on for an event and staff add an event lead address. Applying it in production is a human step.

-- AlterEnum
ALTER TYPE "MessageTemplateKey" ADD VALUE 'BAPTISM_FOLLOW_UP';

-- CreateTable
CREATE TABLE "BaptismFollowUpSetting" (
    "eventId" TEXT NOT NULL,
    "leadEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaptismFollowUpSetting_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "BaptismFollowUp" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "leadNotified" BOOLEAN NOT NULL DEFAULT false,
    "pastorNotified" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaptismFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BaptismFollowUp_eventId_notifiedAt_idx" ON "BaptismFollowUp"("eventId", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BaptismFollowUp_eventId_organizationId_normalizedName_key" ON "BaptismFollowUp"("eventId", "organizationId", "normalizedName");

-- AddForeignKey
ALTER TABLE "BaptismFollowUpSetting" ADD CONSTRAINT "BaptismFollowUpSetting_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaptismFollowUp" ADD CONSTRAINT "BaptismFollowUp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaptismFollowUp" ADD CONSTRAINT "BaptismFollowUp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

