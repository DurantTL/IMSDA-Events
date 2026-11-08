-- Event scoring (#1676). Additive: three enums and three new tables, nothing existing changes.

-- CreateEnum
CREATE TYPE "ActivityScoreKind" AS ENUM ('CLUB', 'PATHFINDER');

-- CreateEnum
CREATE TYPE "ActivityScoreUnit" AS ENUM ('POINTS', 'FEET', 'TIME');

-- CreateEnum
CREATE TYPE "ActivityRibbonMode" AS ENUM ('PLACES', 'BANDS');

-- CreateTable
CREATE TABLE "ScoredActivity" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" "ActivityScoreKind" NOT NULL,
    "unit" "ActivityScoreUnit" NOT NULL DEFAULT 'POINTS',
    "higherWins" BOOLEAN NOT NULL DEFAULT true,
    "ribbonMode" "ActivityRibbonMode" NOT NULL DEFAULT 'PLACES',
    "ribbonPlaces" INTEGER NOT NULL DEFAULT 3,
    "ribbonBands" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoredActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityScore" (
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

    CONSTRAINT "ActivityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventScoringState" (
    "eventId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventScoringState_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "ScoredActivity_eventId_sortOrder_idx" ON "ScoredActivity"("eventId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ScoredActivity_eventId_normalizedName_key" ON "ScoredActivity"("eventId", "normalizedName");

-- CreateIndex
CREATE INDEX "ActivityScore_eventId_organizationId_idx" ON "ActivityScore"("eventId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityScore_scoredEventId_subjectId_key" ON "ActivityScore"("scoredEventId", "subjectId");

-- AddForeignKey
ALTER TABLE "ScoredActivity" ADD CONSTRAINT "ScoredActivity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityScore" ADD CONSTRAINT "ActivityScore_scoredEventId_fkey" FOREIGN KEY ("scoredEventId") REFERENCES "ScoredActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityScore" ADD CONSTRAINT "ActivityScore_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityScore" ADD CONSTRAINT "ActivityScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityScore" ADD CONSTRAINT "ActivityScore_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "RegistrationAttendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventScoringState" ADD CONSTRAINT "EventScoringState_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

