-- Permission to send a staff-entered registration past a closed or full event, with a reason (#1510).
-- Additive only: one enum value. No existing row is read, moved or changed.

-- AlterEnum
ALTER TYPE "EventPermission" ADD VALUE 'OVERRIDE_REGISTRATION_RULES';
