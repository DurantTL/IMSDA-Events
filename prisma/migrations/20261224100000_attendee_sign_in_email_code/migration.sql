-- The emailed sign-in code for club-role accounts without two-step sign-in (#1410).
-- Enum values are only added here; nothing in this migration uses them.
ALTER TYPE "AttendeeStepUpPurpose" ADD VALUE IF NOT EXISTS 'SIGN_IN';
ALTER TYPE "MessageTemplateKey" ADD VALUE IF NOT EXISTS 'ATTENDEE_SIGN_IN_CODE';

ALTER TABLE "AttendeeSession" ADD COLUMN "emailCodeVerifiedAt" TIMESTAMP(3);
