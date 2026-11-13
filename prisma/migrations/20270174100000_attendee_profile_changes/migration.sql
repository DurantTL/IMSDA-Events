-- Attendee profile change history (#1512). ADDITIVE ONLY: one enum and one new table with its indexes, foreign keys and
-- checks. Values are kept only for name, phone and shirt size; applying it in production is a human step (back up first).

-- CreateEnum
CREATE TYPE "AttendeeProfileChangeSource" AS ENUM ('SELF_EDIT', 'REGISTRATION_REVIEW', 'STAFF_CORRECTION');

-- CreateTable
CREATE TABLE "AttendeeProfileChange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "AttendeeProfileChangeSource" NOT NULL,
    "registrationId" TEXT,
    "actorAttendeeAccountId" TEXT,
    "actorUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendeeProfileChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttendeeProfileChange_staff_correction_check" CHECK (
      "source" <> 'STAFF_CORRECTION'
      OR ("actorUserId" IS NOT NULL AND length(btrim(coalesce("reason", ''))) > 0)
    ),
    CONSTRAINT "AttendeeProfileChange_value_retention_check" CHECK (
      "field" IN ('firstName', 'lastName', 'phone', 'shirtSize')
      OR ("oldValue" IS NULL AND "newValue" IS NULL)
    ),
    CONSTRAINT "AttendeeProfileChange_no_health_field_check" CHECK (
      "field" NOT IN ('dietaryNeeds', 'accessibilityNeeds')
    )
);

-- CreateIndex
CREATE INDEX "AttendeeProfileChange_accountId_createdAt_idx" ON "AttendeeProfileChange"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendeeProfileChange_createdAt_idx" ON "AttendeeProfileChange"("createdAt");

-- AddForeignKey
ALTER TABLE "AttendeeProfileChange" ADD CONSTRAINT "AttendeeProfileChange_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AttendeeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeProfileChange" ADD CONSTRAINT "AttendeeProfileChange_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeProfileChange" ADD CONSTRAINT "AttendeeProfileChange_actorAttendeeAccountId_fkey" FOREIGN KEY ("actorAttendeeAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeProfileChange" ADD CONSTRAINT "AttendeeProfileChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
