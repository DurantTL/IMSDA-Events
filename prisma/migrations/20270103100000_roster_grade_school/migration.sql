-- School grade (#1664), school type and church membership (#1668) on a club roster member.
-- Additive: three optional columns, nothing existing is touched.

-- CreateEnum
CREATE TYPE "ClubRosterSchoolGrade" AS ENUM ('GRADE_K', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6', 'GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12', 'NOT_IN_SCHOOL');

-- CreateEnum
CREATE TYPE "ClubRosterSchoolType" AS ENUM ('ADVENTIST_SCHOOL', 'PUBLIC_SCHOOL', 'HOMESCHOOL', 'OTHER');

-- CreateEnum
CREATE TYPE "ClubRosterChurchMember" AS ENUM ('YES', 'NO', 'NOT_SURE');

-- AlterTable
ALTER TABLE "ClubRosterMember" ADD COLUMN     "schoolGrade" "ClubRosterSchoolGrade",
ADD COLUMN     "schoolType" "ClubRosterSchoolType",
ADD COLUMN     "churchMember" "ClubRosterChurchMember";
