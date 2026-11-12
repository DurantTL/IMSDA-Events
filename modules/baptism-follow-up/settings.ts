import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { MembershipLookup, Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { BAPTISM_FOLLOW_UP_MODULE_KEY, parseLeadEmails } from "@/modules/baptism-follow-up/domain";
import { requireStaffToggleAccess } from "@/modules/event-modules/scoped-toggle";

/**
 * Who the baptism notices of an event go to, and what the Baptism follow-up page shows (#1680). Staff only: a system
 * administrator, an Event Admin of the event or the Clubs Administrator (who is an Event Admin on club events), the same people
 * the page admits. The module itself is turned on by a system administrator on the event features page.
 */

export class BaptismFollowUpError extends Error {
  constructor(public readonly code: "EVENT_NOT_FOUND" | "MODULE_OFF" | "INVALID_ADDRESSES", message: string) {
    super(message);
    this.name = "BaptismFollowUpError";
  }
}

/** Staff who may change the event lead addresses. Checked here as well as on the page. */
export async function requireBaptismFollowUpStaff(session: Session, eventId: string, lookup: MembershipLookup) {
  return requireStaffToggleAccess(session, eventId, lookup);
}

async function loadClubEvent(eventId: string) {
  const event = await getPrisma().event.findFirst({ where: { id: eventId, archivedAt: null, audience: "CLUB" }, select: { id: true, name: true } });
  if (!event) throw new BaptismFollowUpError("EVENT_NOT_FOUND", "This is not a club event, or it is archived.");
  return event;
}

export async function baptismFollowUpIsOn(eventId: string): Promise<boolean> {
  const row = await getPrisma().eventModule.findUnique({ where: { eventId_moduleKey: { eventId, moduleKey: BAPTISM_FOLLOW_UP_MODULE_KEY } }, select: { id: true } });
  return row !== null;
}

/** Saves the event lead addresses (empty clears them, which stops notices). Audited with counts only, never an address. */
export async function saveBaptismLeadEmails(actor: { userId: string }, eventId: string, raw: string | readonly string[]) {
  await loadClubEvent(eventId);
  if (!(await baptismFollowUpIsOn(eventId))) throw new BaptismFollowUpError("MODULE_OFF", "Baptism follow-up is off for this event. Ask a system administrator to turn it on.");
  return getPrisma().$transaction(async (tx) => {
    const stored = await tx.baptismFollowUpSetting.findUnique({ where: { eventId }, select: { leadEmails: true } });
    const parsed = parseLeadEmails(raw, stored?.leadEmails ?? []);
    if (!parsed.ok) throw new BaptismFollowUpError("INVALID_ADDRESSES", parsed.message);
    const before = stored?.leadEmails ?? [];
    const same = before.length === parsed.emails.length && before.every((email, index) => email === parsed.emails[index]);
    if (!same) {
      await tx.baptismFollowUpSetting.upsert({
        where: { eventId },
        create: { eventId, leadEmails: parsed.emails },
        update: { leadEmails: parsed.emails },
      });
      await writeAuditLog({
        eventId,
        actorUserId: actor.userId,
        action: "BAPTISM_FOLLOW_UP_LEADS_CHANGED",
        entityType: "BaptismFollowUpSetting",
        entityId: eventId,
        summary: "Changed who is emailed about baptism follow-up.",
        metadata: { eventId, previousCount: before.length, newCount: parsed.emails.length },
      }, tx);
    }
    return { leadEmails: parsed.emails };
  });
}

export type BaptismRecipients = "lead" | "lead and pastor";

export type BaptismClubRow = {
  organizationId: string;
  clubName: string;
  /** The club's church has an active pastor with an email on file. The address itself is never read for this page. */
  pastorOnFile: boolean;
  names: Array<{ displayName: string; notifiedAt: string; recipients: BaptismRecipients }>;
};

export type BaptismFollowUpPage = { enabled: boolean; leadEmails: string[]; clubs: BaptismClubRow[] };

/** What the page shows: the switch, the lead addresses, and the notified names by club. Registered clubs with no pastor on file are listed too. */
export async function loadBaptismFollowUpPage(eventId: string): Promise<BaptismFollowUpPage> {
  await loadClubEvent(eventId);
  const prisma = getPrisma();
  const [enabled, setting, rows, registered] = await Promise.all([
    baptismFollowUpIsOn(eventId),
    prisma.baptismFollowUpSetting.findUnique({ where: { eventId }, select: { leadEmails: true } }),
    prisma.baptismFollowUp.findMany({
      where: { eventId },
      orderBy: [{ notifiedAt: "asc" }, { displayName: "asc" }],
      select: { organizationId: true, displayName: true, notifiedAt: true, pastorNotified: true },
    }),
    prisma.clubEventRegistration.findMany({
      where: { eventId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
      select: { organizationId: true },
    }),
  ]);
  const clubIds = [...new Set([...rows.map((row) => row.organizationId), ...registered.map((row) => row.organizationId)])];
  const clubs = clubIds.length === 0
    ? []
    : await prisma.organization.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true, parentOrganizationId: true } });
  const churchIds = [...new Set(clubs.flatMap((club) => club.parentOrganizationId ?? []))];
  // Existence only: the select leaves the pastor's name and address unread.
  const pastors = churchIds.length === 0
    ? []
    : await prisma.organizationContact.findMany({
      where: { organizationId: { in: churchIds }, kind: "PASTOR", effectiveTo: null, email: { not: null } },
      select: { organizationId: true },
    });
  const churchesWithPastor = new Set(pastors.map((pastor) => pastor.organizationId));
  const result: BaptismClubRow[] = clubs
    .map((club) => ({
      organizationId: club.id,
      clubName: club.name,
      pastorOnFile: club.parentOrganizationId !== null && churchesWithPastor.has(club.parentOrganizationId),
      names: rows
        .filter((row) => row.organizationId === club.id)
        .map((row) => ({ displayName: row.displayName, notifiedAt: row.notifiedAt.toISOString(), recipients: row.pastorNotified ? "lead and pastor" as const : "lead" as const })),
    }))
    .sort((left, right) => left.clubName.localeCompare(right.clubName));
  return { enabled, leadEmails: setting?.leadEmails ?? [], clubs: result };
}
