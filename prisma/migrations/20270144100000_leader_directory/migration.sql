-- Leader directory (#1707). Additive only: three new columns on PlatformSettings (the conference switch, off by default,
-- with who set it and when) and one new table for a leader's own choices. A leader with no row is listed, shares their
-- email and does not share their phone. Drops, renames and moves nothing.

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "leaderDirectoryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaderDirectorySetAt" TIMESTAMP(3),
ADD COLUMN     "leaderDirectorySetByUserId" TEXT;

-- CreateTable
CREATE TABLE "LeaderDirectoryPreference" (
    "id" TEXT NOT NULL,
    "attendeeAccountId" TEXT NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "shareEmail" BOOLEAN NOT NULL DEFAULT true,
    "sharePhone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderDirectoryPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaderDirectoryPreference_attendeeAccountId_key" ON "LeaderDirectoryPreference"("attendeeAccountId");

-- AddForeignKey
ALTER TABLE "LeaderDirectoryPreference" ADD CONSTRAINT "LeaderDirectoryPreference_attendeeAccountId_fkey" FOREIGN KEY ("attendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
