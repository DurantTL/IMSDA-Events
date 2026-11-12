-- Fill-in club letters and certificates (#1708). Additive: one new enum and one new table, nothing altered or dropped.
-- Applying it in production is a human step.

-- CreateEnum
CREATE TYPE "ClubLetterKind" AS ENUM ('LETTER', 'CERTIFICATE');

-- CreateTable
CREATE TABLE "ClubLetterTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ClubLetterKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByAccountId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubLetterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubLetterTemplate_organizationId_idx" ON "ClubLetterTemplate"("organizationId");

-- AddForeignKey
ALTER TABLE "ClubLetterTemplate" ADD CONSTRAINT "ClubLetterTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
