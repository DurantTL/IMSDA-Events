-- One account and one sign-in per person (#554, ADR 0013), slice (a): the link column.
--
-- Additive only. Every existing row starts NULL, nothing reads or writes the column yet,
-- and no account is linked, created or merged here (linking is a human-approved later step).
--
-- ON DELETE SET NULL: removing an AttendeeAccount only unlinks the staff User; it never
-- deletes the User, and deleting a User never touches the AttendeeAccount. The unique
-- index makes the link 1:1 (one account cannot belong to two users).
--
-- PlatformSettings.unifiedSignInEnabled is the one-sign-in switch, OFF by default.

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "unifiedSignInEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "attendeeAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_attendeeAccountId_key" ON "User"("attendeeAccountId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_attendeeAccountId_fkey" FOREIGN KEY ("attendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
