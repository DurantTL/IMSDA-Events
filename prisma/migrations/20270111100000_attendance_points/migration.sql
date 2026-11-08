-- Attendance points (#1677). Additive: two enums and four new tables, nothing existing changes.

-- CreateEnum
CREATE TYPE "AttendancePointsBasis" AS ENUM ('CHECK_IN', 'REGISTRATION');

-- CreateEnum
CREATE TYPE "AttendancePointsOutcome" AS ENUM ('AWARD', 'WITHHOLD');

-- CreateTable
CREATE TABLE "AttendancePointsSetting" (
    "eventId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "requiresPathfinders" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "appliedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePointsSetting_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "AttendancePointsOverride" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outcome" "AttendancePointsOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "setByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePointsOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePointsMark" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attendeeId" TEXT NOT NULL,
    "setByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePointsMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubEventPointAward" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clubYear" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "basis" "AttendancePointsBasis" NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "appliedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubEventPointAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePointsOverride_eventId_organizationId_key" ON "AttendancePointsOverride"("eventId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePointsMark_eventId_attendeeId_key" ON "AttendancePointsMark"("eventId", "attendeeId");

-- CreateIndex
CREATE INDEX "ClubEventPointAward_organizationId_clubYear_idx" ON "ClubEventPointAward"("organizationId", "clubYear");

-- CreateIndex
CREATE UNIQUE INDEX "ClubEventPointAward_eventId_organizationId_key" ON "ClubEventPointAward"("eventId", "organizationId");

-- AddForeignKey
ALTER TABLE "AttendancePointsSetting" ADD CONSTRAINT "AttendancePointsSetting_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePointsOverride" ADD CONSTRAINT "AttendancePointsOverride_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePointsOverride" ADD CONSTRAINT "AttendancePointsOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePointsMark" ADD CONSTRAINT "AttendancePointsMark_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePointsMark" ADD CONSTRAINT "AttendancePointsMark_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "RegistrationAttendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventPointAward" ADD CONSTRAINT "ClubEventPointAward_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventPointAward" ADD CONSTRAINT "ClubEventPointAward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A club's points are a whole number from 1 to 100,000.
ALTER TABLE "AttendancePointsSetting" ADD CONSTRAINT "AttendancePointsSetting_points_range" CHECK ("points" >= 1 AND "points" <= 100000);
ALTER TABLE "ClubEventPointAward" ADD CONSTRAINT "ClubEventPointAward_points_range" CHECK ("points" >= 1 AND "points" <= 100000);
