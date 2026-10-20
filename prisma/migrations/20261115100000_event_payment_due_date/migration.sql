-- Event payment due date (#993): an optional calendar date, in the event's own time zone, that scheduled emails can
-- count back from ("N days before payment due"). Additive only: no existing row changes.
ALTER TABLE "Event" ADD COLUMN "paymentDueOn" TEXT;

ALTER TYPE "ScheduledEmailTrigger" ADD VALUE 'BEFORE_PAYMENT_DUE';
