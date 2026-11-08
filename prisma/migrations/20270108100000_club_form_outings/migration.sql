-- CreateEnum
CREATE TYPE "ClubFormOutingStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "ClubFormLink" ADD COLUMN     "outingId" TEXT;

-- CreateTable
CREATE TABLE "ClubFormOuting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "status" "ClubFormOutingStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubFormOuting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubFormOuting_organizationId_clubYear_status_idx" ON "ClubFormOuting"("organizationId", "clubYear", "status");

-- CreateIndex
CREATE INDEX "ClubFormLink_outingId_idx" ON "ClubFormLink"("outingId");

-- AddForeignKey
ALTER TABLE "ClubFormLink" ADD CONSTRAINT "ClubFormLink_outingId_fkey" FOREIGN KEY ("outingId") REFERENCES "ClubFormOuting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubFormOuting" ADD CONSTRAINT "ClubFormOuting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubFormOuting" ADD CONSTRAINT "ClubFormOuting_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClubFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

