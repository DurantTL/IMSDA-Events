import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { BAPTISM_FOLLOW_UP_MODULE_KEY, FOLLOW_UP_CHANGED_MESSAGE, parseFollowUpNote, type FollowUpInput } from "@/modules/baptism-follow-up/domain";
import { BaptismFollowUpError, baptismFollowUpIsOn, loadClubEvent } from "@/modules/baptism-follow-up/settings";
import { assertScopedToggleAllowed, scopedActorAudit, type ScopedToggleActor } from "@/modules/event-modules/scoped-toggle";

/**
 * Staff, and Area Coordinators, mark a baptism name followed up and keep a short note with it (#1680). One row at a time,
 * found by the event and the row's id together, so a row of another event is "not found". The note is the person's own text
 * and stays on the row: neither it nor the name goes into an audit entry or an email. Who marked it is a staff user or a
 * coordinator's attendee account, never both.
 */

export type FollowUpStatus = { id: string; followedUpAt: string | null; note: string | null };

export async function updateBaptismFollowUp(actor: ScopedToggleActor, eventId: string, followUpId: string, input: FollowUpInput): Promise<FollowUpStatus> {
  await assertScopedToggleAllowed(BAPTISM_FOLLOW_UP_MODULE_KEY, actor);
  await loadClubEvent(eventId, actor.kind);
  if (!(await baptismFollowUpIsOn(eventId))) throw new BaptismFollowUpError("MODULE_OFF", "Baptism follow-up is off for this event. Turn it on first.");
  let nextNote: string | null | undefined;
  if (input.note !== undefined) {
    const parsed = parseFollowUpNote(input.note);
    if (!parsed.ok) throw new BaptismFollowUpError("INVALID_NOTE", parsed.message);
    nextNote = parsed.note;
  }
  const who = scopedActorAudit(actor);
  return getPrisma().$transaction(async (tx) => {
    const row = await tx.baptismFollowUp.findFirst({ where: { id: followUpId, eventId }, select: { id: true, followedUpAt: true, followUpNote: true } });
    if (!row) throw new BaptismFollowUpError("FOLLOW_UP_NOT_FOUND", "That name could not be found.");
    const wasFollowedUp = row.followedUpAt !== null;
    const statusChanged = input.followedUp !== undefined && input.followedUp !== wasFollowedUp;
    const noteChanged = nextNote !== undefined && nextNote !== row.followUpNote;
    // The form saves what it saw: if the row is no longer as the form loaded it, someone else changed it. Nothing is overwritten.
    const sameMoment = (row.followedUpAt?.toISOString() ?? null) === input.expectedFollowedUpAt;
    if (!sameMoment || row.followUpNote !== input.expectedNote) throw new BaptismFollowUpError("CONFLICT", FOLLOW_UP_CHANGED_MESSAGE);
    if (!statusChanged && !noteChanged) return { id: row.id, followedUpAt: row.followedUpAt?.toISOString() ?? null, note: row.followUpNote };
    const data: { followedUpAt?: Date | null; followedUpByUserId?: string | null; followedUpByAttendeeAccountId?: string | null; followUpNote?: string | null } = {};
    if (statusChanged) {
      if (input.followedUp) {
        data.followedUpAt = new Date();
        data.followedUpByUserId = actor.kind === "staff" ? actor.userId : null;
        data.followedUpByAttendeeAccountId = actor.kind === "area-coordinator" ? actor.accountId : null;
      } else {
        // Unmarking clears when and who, and keeps the note.
        data.followedUpAt = null;
        data.followedUpByUserId = null;
        data.followedUpByAttendeeAccountId = null;
      }
    }
    if (noteChanged) data.followUpNote = nextNote ?? null;
    // Conditional write: only while the row still holds the expected values (a racing save leaves count 0).
    const changed = await tx.baptismFollowUp.updateMany({ where: { id: row.id, eventId, followedUpAt: row.followedUpAt, followUpNote: row.followUpNote }, data });
    if (changed.count === 0) throw new BaptismFollowUpError("CONFLICT", FOLLOW_UP_CHANGED_MESSAGE);
    const updated = await tx.baptismFollowUp.findFirstOrThrow({ where: { id: row.id }, select: { id: true, followedUpAt: true, followUpNote: true } });
    await writeAuditLog({
      eventId,
      ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
      action: "BAPTISM_FOLLOW_UP_STATUS_CHANGED",
      entityType: "BaptismFollowUp",
      entityId: row.id,
      summary: "Changed a baptism follow-up status or note.",
      // Never the name and never the note's text: only the event, the new status and whether the note changed.
      metadata: { ...who.metadata, eventId, followedUp: updated.followedUpAt !== null, noteChanged },
    }, tx);
    return { id: updated.id, followedUpAt: updated.followedUpAt?.toISOString() ?? null, note: updated.followUpNote };
  });
}

/** An Area Coordinator opened the names list: one audit entry with the count, never a name or a note. */
export async function recordBaptismListViewed(actor: ScopedToggleActor & { kind: "area-coordinator" }, eventId: string, nameCount: number) {
  const who = scopedActorAudit(actor);
  await writeAuditLog({
    eventId,
    action: "BAPTISM_FOLLOW_UP_LIST_VIEWED",
    entityType: "BaptismFollowUp",
    entityId: eventId,
    summary: "An Area Coordinator opened the baptism follow-up names list.",
    metadata: { ...who.metadata, eventId, nameCount },
  });
}
