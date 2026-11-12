import "server-only";

import { getPrisma } from "@/lib/prisma";
import { ACTIVE_REGISTRATION_STATUSES, ROLE_LABELS, STAFFING_MODULE_KEY, type StaffingRole } from "@/modules/event-staffing/domain";

/**
 * What one signed-in person is assigned to (#1678): their own activities, on their own account page, and nothing else.
 * Never another person's name, never the rest of the sheet, never a head count. It is the only reader of the sheet that is
 * not an event staff member or an Area Coordinator, so it takes an attendee account (id and verified email) and finds the
 * assignments that account owns:
 *   - a registered person whose email is the account's verified email (the same match "My registrations" uses), or who is
 *     linked to the account by a recorded person link;
 *   - an event staff user linked to the account (`User.attendeeAccountId`).
 * An assignment shows only while the event is a published club event with Event staffing on, and the person is still registered
 * (submitted or confirmed) or still on the staff. Nothing else on the account changes.
 */

export type OwnAssignment = {
  id: string;
  eventName: string;
  activityName: string;
  roleLabel: string;
  role: StaffingRole;
  location: string;
  timeText: string;
  description: string;
};

export async function listOwnAssignments(account: { id: string; verifiedEmail: string }): Promise<OwnAssignment[]> {
  const prisma = getPrisma();
  const email = account.verifiedEmail.trim().toLowerCase();
  const rows = await prisma.eventStaffingAssignment.findMany({
    where: {
      event: { archivedAt: null, isPublished: true, audience: "CLUB", modules: { some: { moduleKey: STAFFING_MODULE_KEY } } },
      OR: [
        ...(email ? [{ person: { normalizedEmail: email } }] : []),
        { person: { attendeeAccountLinks: { some: { accountId: account.id } } } },
        { user: { attendeeAccountId: account.id } },
      ],
    },
    orderBy: [{ event: { startsAt: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      eventId: true,
      role: true,
      personId: true,
      userId: true,
      event: { select: { name: true } },
      activity: { select: { name: true, location: true, timeText: true, description: true } },
    },
  });
  if (rows.length === 0) return [];
  const personKeys = rows.flatMap((row) => (row.personId ? [{ eventId: row.eventId, personId: row.personId }] : []));
  const userKeys = rows.flatMap((row) => (row.userId ? [{ eventId: row.eventId, userId: row.userId }] : []));
  const [registered, staff] = await Promise.all([
    personKeys.length === 0 ? [] : prisma.registrationAttendee.findMany({
      where: { registration: { status: { in: [...ACTIVE_REGISTRATION_STATUSES] } }, OR: personKeys },
      select: { eventId: true, personId: true },
    }),
    userKeys.length === 0 ? [] : prisma.eventMembership.findMany({ where: { status: "ACTIVE", OR: userKeys }, select: { eventId: true, userId: true } }),
  ]);
  const registeredKeys = new Set(registered.map((row) => `${row.eventId}:${row.personId}`));
  const staffKeys = new Set(staff.map((row) => `${row.eventId}:${row.userId}`));
  return rows
    .filter((row) => (row.personId ? registeredKeys.has(`${row.eventId}:${row.personId}`) : staffKeys.has(`${row.eventId}:${row.userId}`)))
    .map((row) => ({
      id: row.id,
      eventName: row.event.name,
      activityName: row.activity.name,
      roleLabel: ROLE_LABELS[row.role],
      role: row.role,
      location: row.activity.location,
      timeText: row.activity.timeText,
      description: row.activity.description,
    }));
}
