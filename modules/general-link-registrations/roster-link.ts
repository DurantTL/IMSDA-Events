import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { GeneralLinkError } from "@/modules/general-link-registrations/repository";

/**
 * Linking a typed-in team member to someone on the club's roster (#931), by the club's director, deputy or registrar in the
 * portal. Optional and never required: the registration, its answers, the person record and the price do not change, and
 * nothing is created or merged. It only records on the attendee which roster member the extra person is (`linkedRosterMemberId`),
 * so the director's own records line up. Only an extra person (someone typed in, not taken from the roster) of this club's own
 * registration can be linked, and only to an active member of the same club.
 */
export async function linkExtraPersonToRoster(input: {
  organizationId: string;
  eventId: string;
  attendeeId: string;
  /** The roster member to link to, or null to remove the link. */
  rosterMemberId: string | null;
  actor: { accountId: string } | { userId: string; actAsId: string };
}) {
  return getPrisma().$transaction(async (tx) => {
    const attendee = await tx.registrationAttendee.findFirst({
      where: {
        id: input.attendeeId,
        eventId: input.eventId,
        registration: { status: { in: [...activeRegistrationStatuses] }, clubRegistration: { is: { organizationId: input.organizationId } } },
      },
      select: { id: true, registrationId: true, profileSnapshot: true },
    });
    const snapshot = attendee?.profileSnapshot && typeof attendee.profileSnapshot === "object" && !Array.isArray(attendee.profileSnapshot)
      ? attendee.profileSnapshot as Record<string, unknown>
      : {};
    if (!attendee || snapshot.temporary !== true) {
      throw new GeneralLinkError("SUBMISSION_NOT_FOUND", "That person isn't an extra person on your club's registration.");
    }
    if (input.rosterMemberId) {
      const member = await tx.clubRosterMember.findFirst({
        where: { id: input.rosterMemberId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) throw new GeneralLinkError("CLUB_INVALID", "Choose someone who is active on your club roster.");
    }
    const { linkedRosterMemberId: previous, ...rest } = snapshot;
    void previous;
    await tx.registrationAttendee.update({
      where: { id: attendee.id },
      data: { profileSnapshot: { ...rest, ...(input.rosterMemberId ? { linkedRosterMemberId: input.rosterMemberId } : {}) } as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        eventId: input.eventId,
        ...("userId" in input.actor ? { actorUserId: input.actor.userId } : {}),
        action: input.rosterMemberId ? "CLUB_EXTRA_PERSON_ROSTER_LINKED" : "CLUB_EXTRA_PERSON_ROSTER_UNLINKED",
        entityType: "RegistrationAttendee",
        entityId: attendee.id,
        correlationId: randomUUID(),
        summary: input.rosterMemberId ? "A director linked an extra person on a team to a roster member." : "A director removed the roster link of an extra person on a team.",
        // Ids only: never the person's name.
        metadata: {
          registrationId: attendee.registrationId,
          organizationId: input.organizationId,
          rosterMemberId: input.rosterMemberId,
          ...("accountId" in input.actor ? { actorAttendeeAccountId: input.actor.accountId } : { actAsId: input.actor.actAsId }),
        },
      },
    });
    return { attendeeId: attendee.id, linkedRosterMemberId: input.rosterMemberId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
