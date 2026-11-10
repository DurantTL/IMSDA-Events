-- Personal staff invitation links open for 14 days (#1787). Additive: one timestamp, when the link's window last started.
-- Rows that exist when this runs get the deploy time, so every outstanding link has 14 days from the deploy.

-- AlterTable
ALTER TABLE "StaffInvitation" ADD COLUMN "linkIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
