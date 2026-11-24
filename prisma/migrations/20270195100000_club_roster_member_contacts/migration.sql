-- #2060: optional contact details (email, phone, mailing address) per club roster member,
-- separate from emergency contacts and parents. Additive only: one new table, no change to
-- any existing table or row. Plain text on purpose. A row cascades with the roster member,
-- and the app also deletes it explicitly when a member is removed.

-- CreateTable
CREATE TABLE "ClubRosterMemberContact" (
    "id" TEXT NOT NULL,
    "rosterMemberId" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubRosterMemberContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubRosterMemberContact_rosterMemberId_key" ON "ClubRosterMemberContact"("rosterMemberId");

-- AddForeignKey
ALTER TABLE "ClubRosterMemberContact" ADD CONSTRAINT "ClubRosterMemberContact_rosterMemberId_fkey" FOREIGN KEY ("rosterMemberId") REFERENCES "ClubRosterMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
