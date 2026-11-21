-- #2058: up to two parent or guardian contacts per club roster member, separate from
-- emergency contacts. Additive only: one new table, no change to any existing table or
-- row. Plain text on purpose. Rows cascade with the roster member, and the app also
-- deletes them explicitly when a member is removed.

-- CreateTable
CREATE TABLE "ClubRosterParent" (
    "id" TEXT NOT NULL,
    "rosterMemberId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "relationship" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubRosterParent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClubRosterParent_position_check" CHECK ("position" IN (1, 2))
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubRosterParent_rosterMemberId_position_key" ON "ClubRosterParent"("rosterMemberId", "position");

-- AddForeignKey
ALTER TABLE "ClubRosterParent" ADD CONSTRAINT "ClubRosterParent_rosterMemberId_fkey" FOREIGN KEY ("rosterMemberId") REFERENCES "ClubRosterMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
