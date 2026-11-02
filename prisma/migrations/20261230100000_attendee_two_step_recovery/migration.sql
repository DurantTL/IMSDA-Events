-- Self-service lost-device recovery for attendee accounts (#221). Enum values are only added here; nothing in
-- this migration uses them.
ALTER TYPE "AttendeeStepUpPurpose" ADD VALUE IF NOT EXISTS 'TWO_STEP_RECOVERY';
ALTER TYPE "MessageTemplateKey" ADD VALUE IF NOT EXISTS 'ATTENDEE_TWO_STEP_RECOVERY_CODE';
ALTER TYPE "MessageTemplateKey" ADD VALUE IF NOT EXISTS 'ATTENDEE_TWO_STEP_RECOVERY_NOTICE';
