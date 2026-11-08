-- Club teachers tool (#1681). Additive: two new tables, nothing existing changes.

-- CreateTable
CREATE TABLE "ClubTeacherRule" (
    "eventId" TEXT NOT NULL,
    "baseTeachers" INTEGER NOT NULL DEFAULT 1,
    "largerClubOver" INTEGER,
    "largerClubTeachers" INTEGER NOT NULL DEFAULT 2,
    "requireTeachers" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "updatedByAccountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubTeacherRule_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "ClubEventTeacher" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rosterMemberId" TEXT NOT NULL,
    "honorName" TEXT,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubEventTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubEventTeacher_eventId_locationId_idx" ON "ClubEventTeacher"("eventId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubEventTeacher_eventId_organizationId_rosterMemberId_key" ON "ClubEventTeacher"("eventId", "organizationId", "rosterMemberId");

-- AddForeignKey
ALTER TABLE "ClubTeacherRule" ADD CONSTRAINT "ClubTeacherRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventTeacher" ADD CONSTRAINT "ClubEventTeacher_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventTeacher" ADD CONSTRAINT "ClubEventTeacher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventTeacher" ADD CONSTRAINT "ClubEventTeacher_rosterMemberId_fkey" FOREIGN KEY ("rosterMemberId") REFERENCES "ClubRosterMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEventTeacher" ADD CONSTRAINT "ClubEventTeacher_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "EventLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
