-- The general registration link (#931). Additive only: one event setting and one table. Nothing existing changes.

-- An event can offer one public link where directors with no account register a team (the Pathfinder Bible Experience).
ALTER TABLE "Event" ADD COLUMN "generalRegistrationLinkEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "GeneralLinkSubmissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GeneralLinkResolution" AS ENUM ('AUTO_EMAIL_MATCH', 'STAFF_CONFIRMED', 'STAFF_REASSIGNED', 'STAFF_REJECTED');

-- CreateTable
CREATE TABLE "GeneralLinkSubmission" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "GeneralLinkSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" "GeneralLinkResolution",
    "confirmationCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "clubNameAsEntered" TEXT NOT NULL,
    "suggestedOrganizationId" TEXT,
    "organizationId" TEXT,
    "directorEmail" TEXT NOT NULL,
    "directorName" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "locationId" TEXT,
    "attendeeCount" INTEGER NOT NULL,
    "payload" JSONB,
    "registrationId" TEXT,
    "rejectReason" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneralLinkSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneralLinkSubmission_confirmationCode_key" ON "GeneralLinkSubmission"("confirmationCode");

-- CreateIndex
CREATE UNIQUE INDEX "GeneralLinkSubmission_registrationId_key" ON "GeneralLinkSubmission"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneralLinkSubmission_eventId_idempotencyKey_key" ON "GeneralLinkSubmission"("eventId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GeneralLinkSubmission_eventId_status_createdAt_idx" ON "GeneralLinkSubmission"("eventId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_suggestedOrganizationId_fkey" FOREIGN KEY ("suggestedOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "EventLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The submitted answers (the team members' names and ages) exist exactly while the submission waits: a resolved
-- submission keeps none of them, and a waiting one always has them.
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_payload_check" CHECK (("status" = 'PENDING') = ("payload" IS NOT NULL));

-- A submission is resolved exactly when it is no longer PENDING.
ALTER TABLE "GeneralLinkSubmission" ADD CONSTRAINT "GeneralLinkSubmission_resolved_check" CHECK (
    ("status" = 'PENDING') = ("resolvedAt" IS NULL)
    AND ("status" = 'PENDING') = ("resolution" IS NULL)
);

-- A waiting team's name is reserved within the event (case and spacing aside), so two submissions racing for one name give
-- one winner. A resolved row releases it: a registered team's name is then held by its `ClubEventRegistration`
-- (index `ClubEventRegistration_event_team_name_key`). Prisma can not model a partial index, and `migrate diff` leaves one alone.
CREATE UNIQUE INDEX "GeneralLinkSubmission_event_pending_team_name_key" ON "GeneralLinkSubmission"("eventId", "teamKey") WHERE "status" = 'PENDING' AND "teamKey" <> '';
