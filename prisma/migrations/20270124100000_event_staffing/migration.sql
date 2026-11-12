-- Optional event staffing sheet (#1678). Additive: a new enum and two new tables for an event's activities and who is assigned
-- to them. Drops no column or table, renames nothing, and moves no data. Names are read from registrations and staff accounts
-- when the sheet is opened and are not stored here.

-- CreateEnum
CREATE TYPE "EventStaffingRole" AS ENUM ('LEAD', 'HELPER', 'LIFEGUARD', 'TLT');

-- CreateTable
CREATE TABLE "EventStaffingActivity" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "timeText" TEXT NOT NULL DEFAULT '',
    "tltsNeeded" INTEGER NOT NULL DEFAULT 0,
    "lifeguardsNeeded" INTEGER NOT NULL DEFAULT 0,
    "helpersNeeded" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventStaffingActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventStaffingActivity_needed_check" CHECK (
        "tltsNeeded" >= 0 AND "tltsNeeded" <= 200
        AND "lifeguardsNeeded" >= 0 AND "lifeguardsNeeded" <= 200
        AND "helpersNeeded" >= 0 AND "helpersNeeded" <= 200
    )
);

-- CreateTable
CREATE TABLE "EventStaffingAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "role" "EventStaffingRole" NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "attendeeAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStaffingAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventStaffingAssignment_one_assignee_check" CHECK (
        (("personId" IS NOT NULL)::int + ("userId" IS NOT NULL)::int + ("attendeeAccountId" IS NOT NULL)::int) = 1
    ),
    CONSTRAINT "EventStaffingAssignment_account_lead_check" CHECK ("attendeeAccountId" IS NULL OR "role" = 'LEAD')
);

-- CreateIndex
CREATE INDEX "EventStaffingActivity_eventId_position_idx" ON "EventStaffingActivity"("eventId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "EventStaffingAssignment_activityId_personId_key" ON "EventStaffingAssignment"("activityId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "EventStaffingAssignment_activityId_userId_key" ON "EventStaffingAssignment"("activityId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventStaffingAssignment_activityId_attendeeAccountId_key" ON "EventStaffingAssignment"("activityId", "attendeeAccountId");

-- CreateIndex
CREATE INDEX "EventStaffingAssignment_eventId_attendeeAccountId_idx" ON "EventStaffingAssignment"("eventId", "attendeeAccountId");

-- CreateIndex
CREATE INDEX "EventStaffingAssignment_eventId_personId_idx" ON "EventStaffingAssignment"("eventId", "personId");

-- CreateIndex
CREATE INDEX "EventStaffingAssignment_eventId_userId_idx" ON "EventStaffingAssignment"("eventId", "userId");

-- CreateIndex
CREATE INDEX "EventStaffingAssignment_activityId_role_idx" ON "EventStaffingAssignment"("activityId", "role");

-- One lead per activity.
CREATE UNIQUE INDEX "EventStaffingAssignment_one_lead_key" ON "EventStaffingAssignment"("activityId") WHERE "role" = 'LEAD';

-- AddForeignKey
ALTER TABLE "EventStaffingActivity" ADD CONSTRAINT "EventStaffingActivity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaffingAssignment" ADD CONSTRAINT "EventStaffingAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaffingAssignment" ADD CONSTRAINT "EventStaffingAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "EventStaffingActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaffingAssignment" ADD CONSTRAINT "EventStaffingAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaffingAssignment" ADD CONSTRAINT "EventStaffingAssignment_attendeeAccountId_fkey" FOREIGN KEY ("attendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStaffingAssignment" ADD CONSTRAINT "EventStaffingAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
