-- Camporee scoring (#1676). Additive: three enums and three new tables, nothing existing changes.

-- CreateEnum
CREATE TYPE "CamporeeScoreKind" AS ENUM ('CLUB', 'PATHFINDER');

-- CreateEnum
CREATE TYPE "CamporeeScoreUnit" AS ENUM ('POINTS', 'FEET', 'TIME');

-- CreateEnum
CREATE TYPE "CamporeeRibbonMode" AS ENUM ('PLACES', 'BANDS');

-- CreateTable
CREATE TABLE "CamporeeScoredEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" "CamporeeScoreKind" NOT NULL,
    "unit" "CamporeeScoreUnit" NOT NULL DEFAULT 'POINTS',
    "higherWins" BOOLEAN NOT NULL DEFAULT true,
    "ribbonMode" "CamporeeRibbonMode" NOT NULL DEFAULT 'PLACES',
    "ribbonPlaces" INTEGER NOT NULL DEFAULT 3,
    "ribbonBands" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CamporeeScoredEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CamporeeScore" (
    "id" TEXT NOT NULL,
    "scoredEventId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "attendeeId" TEXT,
    "valueHundredths" INTEGER NOT NULL,
    "enteredByUserId" TEXT,
    "enteredByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CamporeeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CamporeeScoringState" (
    "eventId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CamporeeScoringState_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "CamporeeScoredEvent_eventId_sortOrder_idx" ON "CamporeeScoredEvent"("eventId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CamporeeScoredEvent_eventId_normalizedName_key" ON "CamporeeScoredEvent"("eventId", "normalizedName");

-- CreateIndex
CREATE INDEX "CamporeeScore_eventId_organizationId_idx" ON "CamporeeScore"("eventId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CamporeeScore_scoredEventId_subjectId_key" ON "CamporeeScore"("scoredEventId", "subjectId");

-- AddForeignKey
ALTER TABLE "CamporeeScoredEvent" ADD CONSTRAINT "CamporeeScoredEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamporeeScore" ADD CONSTRAINT "CamporeeScore_scoredEventId_fkey" FOREIGN KEY ("scoredEventId") REFERENCES "CamporeeScoredEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamporeeScore" ADD CONSTRAINT "CamporeeScore_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamporeeScore" ADD CONSTRAINT "CamporeeScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamporeeScore" ADD CONSTRAINT "CamporeeScore_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "RegistrationAttendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamporeeScoringState" ADD CONSTRAINT "CamporeeScoringState_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

