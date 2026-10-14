import "server-only";

import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import { deleteExpiredHealthSnapshots, sealHealthSnapshot, sealStartedEventSnapshots } from "@/modules/health-records/snapshot-repository";

/**
 * The two places the rest of the app calls into sealed health copies (#924).
 * Neither ever throws: a failure here must not fail a check-in or a sweep.
 * Sealing (at check-in and at event start) is a no-op with HEALTH_RECORDS_ENABLED
 * off. The expiry deletion is not: it runs whatever the flag says, so switching the
 * feature off never extends how long a copy is kept. They log through the
 * redacting logger with the action text and the error only, never an id of a
 * record or a value.
 */

/**
 * Called by the check-in route after a check-in succeeds (the arrival is
 * recorded first and is never held up by this). Seals the person's copy for the
 * event if they have a live record and none exists yet. Takes the attendee id
 * the route already has and resolves the person from it.
 */
export async function sealHealthSnapshotAfterCheckIn(eventId: string, attendeeId: string) {
  if (!healthRecordsEnabled()) return;
  try {
    const attendee = await getPrisma().registrationAttendee.findFirst({ where: { id: attendeeId, eventId }, select: { personId: true } });
    if (!attendee) return;
    await sealHealthSnapshot({ eventId, personId: attendee.personId, trigger: "CHECK_IN" });
  } catch (error) {
    const action = "Sealing a health copy at check-in";
    logError(`${action} failed`, error);
  }
}

/**
 * Called by the scheduled sweep (the same authenticated outbox sweep that runs the
 * other periodic work). Takes the event-start copies that are due and runs the
 * daily deletion of expired copies. Returns counts only. With HEALTH_RECORDS_ENABLED
 * off only the deletion runs (`started` is null): nothing new is sealed, but a copy
 * that has expired is still deleted, unless a legal hold covers it.
 */
export async function runHealthSnapshotSweep(now = new Date()) {
  const started = !healthRecordsEnabled() ? null : await sealStartedEventSnapshots(now).catch((error: unknown) => {
    const action = "Sealing event-start health copies";
    logError(`${action} failed`, error);
    return null;
  });
  const retention = await deleteExpiredHealthSnapshots(now).catch((error: unknown) => {
    const action = "Deleting expired sealed health copies";
    logError(`${action} failed`, error);
    return null;
  });
  return { started, retention };
}
