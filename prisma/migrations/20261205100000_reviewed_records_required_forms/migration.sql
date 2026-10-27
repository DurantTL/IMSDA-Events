-- Reviewed monthly records and required club forms (#1246). Additive: two nullable columns on "ClubMonthlyReport",
-- one enum, and four columns with safe defaults on "ClubFormTemplate". Existing records are not reviewed and no form
-- is required. Applying it in production is a human step (back up first).

-- CreateEnum
CREATE TYPE "ClubFormRequirement" AS ENUM ('NOT_REQUIRED', 'ONCE_PER_CLUB_YEAR', 'PER_ROLE_MEMBER_YEAR');

-- AlterTable
ALTER TABLE "ClubMonthlyReport" ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedByUserId" TEXT;

-- AlterTable
ALTER TABLE "ClubFormTemplate" ADD COLUMN "requirement" "ClubFormRequirement" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "requiredRoles" "ClubRosterAttendeeType"[] NOT NULL DEFAULT ARRAY[]::"ClubRosterAttendeeType"[],
ADD COLUMN "requirementChangedAt" TIMESTAMP(3),
ADD COLUMN "requirementChangedByUserId" TEXT;
