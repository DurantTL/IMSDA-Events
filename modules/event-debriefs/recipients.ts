import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { dedupeRecipients, type DebriefFormPurpose, type DebriefRecipient } from "@/modules/event-debriefs/domain";

type Client = PrismaClient | Prisma.TransactionClient;

/** Roles that run a club and answer for it: the director and the deputy. A registrar or reporter is not asked to evaluate. */
const evaluationRoles = ["DIRECTOR", "DEPUTY"] as const;

const activeAccount = { disabledAt: null, status: "ACTIVE" as const };

/**
 * The one place that decides who is asked to answer a debrief form, for sending the email, for the reminder, and for
 * refusing an answer from anyone else. Reads current state, so a person removed since the invitation is no longer a
 * recipient.
 *
 *  - DEBRIEF: people with an ACTIVE staff membership on the event, and every active Area Coordinator. An Area
 *    Coordinator grant carries no area, so the whole lasting set is used (a temporary "acting as" grant, which has an end
 *    date that has not passed, counts while it lasts, the same test `isAreaCoordinator` uses). A staff member answers
 *    with the attendee account their staff sign-in is linked to; a staff member with no linked account has nothing to
 *    sign in with on the form and is not on the list.
 *  - DIRECTOR_EVALUATION: the director and deputy of each club that has a submitted or confirmed registration for the
 *    event. Whether the evaluation is switched on is the caller's decision.
 */
export async function resolveDebriefRecipients(client: Client, eventId: string, purpose: DebriefFormPurpose, now: Date): Promise<DebriefRecipient[]> {
  if (purpose === "DEBRIEF") {
    const [members, grants] = await Promise.all([
      client.eventMembership.findMany({
        where: { eventId, status: "ACTIVE", user: { accountStatus: "ACTIVE", attendeeAccount: { is: activeAccount } } },
        select: { user: { select: { attendeeAccount: { select: { id: true, email: true, displayName: true } } } } },
      }),
      client.areaCoordinatorGrant.findMany({
        where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], attendeeAccount: activeAccount },
        select: { attendeeAccount: { select: { id: true, email: true, displayName: true } } },
      }),
    ]);
    const rows = [
      ...members.flatMap((member) => (member.user.attendeeAccount ? [member.user.attendeeAccount] : [])),
      ...grants.map((grant) => grant.attendeeAccount),
    ].map((account) => ({ accountId: account.id, email: account.email, name: account.displayName }));
    return dedupeRecipients(rows);
  }
  const grants = await client.clubDirectorGrant.findMany({
    where: {
      role: { in: [...evaluationRoles] },
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      attendeeAccount: activeAccount,
      organization: { type: "CLUB", isActive: true, eventRegistrations: { some: { eventId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } } } },
    },
    select: { attendeeAccount: { select: { id: true, email: true, displayName: true } } },
  });
  return dedupeRecipients(grants.map((grant) => ({ accountId: grant.attendeeAccount.id, email: grant.attendeeAccount.email, name: grant.attendeeAccount.displayName })));
}

/** Whether one account is on the list now. */
export async function isDebriefRecipient(client: Client, eventId: string, purpose: DebriefFormPurpose, accountId: string, now: Date): Promise<boolean> {
  const recipients = await resolveDebriefRecipients(client, eventId, purpose, now);
  return recipients.some((recipient) => recipient.accountId === accountId);
}

/** The accounts that have already answered the event's form of this purpose. */
export async function answeredAccountIds(client: Client, eventId: string, purpose: DebriefFormPurpose): Promise<Set<string>> {
  const rows = await client.informationFormResponse.findMany({
    where: { attendeeAccountId: { not: null }, form: { eventId, purpose } },
    select: { attendeeAccountId: true },
    distinct: ["attendeeAccountId"],
  });
  return new Set(rows.flatMap((row) => (row.attendeeAccountId ? [row.attendeeAccountId] : [])));
}
