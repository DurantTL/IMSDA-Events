-- Club roster carry-forward (#414). Additive: one new table, no change to existing rows.

-- CreateTable
CREATE TABLE "ClubRosterCarryForward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromClubYear" TEXT NOT NULL,
    "toClubYear" TEXT NOT NULL,
    "carriedCount" INTEGER NOT NULL,
    "leftBehindCount" INTEGER NOT NULL,
    "typeChangedCount" INTEGER NOT NULL,
    "confirmedByAccountId" TEXT,
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubRosterCarryForward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubRosterCarryForward_organizationId_toClubYear_key" ON "ClubRosterCarryForward"("organizationId", "toClubYear");

-- AddForeignKey
ALTER TABLE "ClubRosterCarryForward" ADD CONSTRAINT "ClubRosterCarryForward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubRosterCarryForward" ADD CONSTRAINT "ClubRosterCarryForward_confirmedByAccountId_fkey" FOREIGN KEY ("confirmedByAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubRosterCarryForward" ADD CONSTRAINT "ClubRosterCarryForward_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
