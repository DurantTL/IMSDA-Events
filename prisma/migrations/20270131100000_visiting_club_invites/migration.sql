-- Visiting club invites (#835). Additive only: two enums, two tables, one nullable column on "Organization" (the guest
-- club's one event; null for every existing club), one billing source and three message template keys. Nothing
-- existing is changed or deleted. Matches `prisma migrate diff` against the schema exactly.

-- CreateEnum
CREATE TYPE "VisitingClubRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "VisitingClubType" AS ENUM ('PATHFINDER', 'ADVENTURER');

-- AlterEnum
ALTER TYPE "BillingResponsibilitySource" ADD VALUE 'VISITING_CLUB';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessageTemplateKey" ADD VALUE 'VISITING_CLUB_INVITE';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'VISITING_CLUB_APPROVED';
ALTER TYPE "MessageTemplateKey" ADD VALUE 'VISITING_CLUB_DECLINED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "guestEventId" TEXT;

-- CreateTable
CREATE TABLE "VisitingClubInvite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT,
    "messageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitingClubInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitingClubRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "submittedByAccountId" TEXT NOT NULL,
    "status" "VisitingClubRequestStatus" NOT NULL DEFAULT 'PENDING',
    "clubName" TEXT NOT NULL,
    "clubType" "VisitingClubType" NOT NULL,
    "homeConference" TEXT NOT NULL,
    "homeChurch" TEXT NOT NULL,
    "directorName" TEXT NOT NULL,
    "directorEmail" TEXT NOT NULL,
    "directorPhone" TEXT NOT NULL,
    "screeningConfirmedAt" TIMESTAMP(3) NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdOrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitingClubRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitingClubInvite_tokenHash_key" ON "VisitingClubInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "VisitingClubInvite_messageId_key" ON "VisitingClubInvite"("messageId");

-- CreateIndex
CREATE INDEX "VisitingClubInvite_eventId_createdAt_idx" ON "VisitingClubInvite"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "VisitingClubInvite_email_idx" ON "VisitingClubInvite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VisitingClubRequest_inviteId_key" ON "VisitingClubRequest"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitingClubRequest_createdOrganizationId_key" ON "VisitingClubRequest"("createdOrganizationId");

-- CreateIndex
CREATE INDEX "VisitingClubRequest_status_createdAt_idx" ON "VisitingClubRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VisitingClubRequest_eventId_status_idx" ON "VisitingClubRequest"("eventId", "status");

-- CreateIndex
CREATE INDEX "VisitingClubRequest_submittedByAccountId_idx" ON "VisitingClubRequest"("submittedByAccountId");

-- CreateIndex
CREATE INDEX "Organization_guestEventId_idx" ON "Organization"("guestEventId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_guestEventId_fkey" FOREIGN KEY ("guestEventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubInvite" ADD CONSTRAINT "VisitingClubInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubInvite" ADD CONSTRAINT "VisitingClubInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubRequest" ADD CONSTRAINT "VisitingClubRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubRequest" ADD CONSTRAINT "VisitingClubRequest_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "VisitingClubInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubRequest" ADD CONSTRAINT "VisitingClubRequest_submittedByAccountId_fkey" FOREIGN KEY ("submittedByAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubRequest" ADD CONSTRAINT "VisitingClubRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitingClubRequest" ADD CONSTRAINT "VisitingClubRequest_createdOrganizationId_fkey" FOREIGN KEY ("createdOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

