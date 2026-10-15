/**
 * Archiving an event (#635): the pure rules, free of the database so they are
 * unit-tested on their own. `archive-repository.ts` performs the change.
 *
 * Archiving hides an event and closes registration for it. It deletes and
 * changes nothing else, and unarchiving restores everything exactly.
 */

export type EventArchiveActor = {
  globalRole?: "SYSTEM_ADMIN" | null;
  /** The actor's role on this event when the membership is active, or null when they have none. */
  eventRole: string | null;
};

export type EventArchiveDecision = { allowed: true } | { allowed: false; reason: string };

/** Only a system administrator or the event's own Event Admin may archive or unarchive it. */
export function decideEventArchiveAccess(actor: EventArchiveActor): EventArchiveDecision {
  if (actor.globalRole === "SYSTEM_ADMIN" || actor.eventRole === "EVENT_ADMIN") return { allowed: true };
  return { allowed: false, reason: "Only a system administrator or this event's Event Admin can archive or unarchive an event." };
}

export type EventArchiveState = { archivedAt: Date | null };

export function isEventArchived(event: EventArchiveState): boolean {
  return Boolean(event.archivedAt);
}

/** Events that should appear in pickers, switchers, default selection and public listings. */
export function withoutArchivedEvents<T extends EventArchiveState>(events: readonly T[]): T[] {
  return events.filter((event) => !isEventArchived(event));
}

export const EVENT_ARCHIVED_AUDIT_ACTION = "EVENT_ARCHIVED";
export const EVENT_UNARCHIVED_AUDIT_ACTION = "EVENT_UNARCHIVED";

/** What the audit row keeps: identifiers only, never names, dates or attendee data. */
export type EventArchiveAuditMetadata = { eventId: string };

/** Wording the dialog and the archived banner share. */
export const EVENT_ARCHIVE_EFFECTS =
  "It disappears from event pickers, the dashboard default, the public site and the public calendar, and registration closes. Nothing is deleted or changed: its registrations, payments, forms and records stay, and reports and exports still work from the Archived events list. Unarchiving restores it exactly.";
