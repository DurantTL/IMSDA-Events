import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { MembershipLookup, Session } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { BAPTISM_FOLLOW_UP_MODULE_KEY, parseLeadEmails, usablePastorEmail } from "@/modules/baptism-follow-up/domain";
import {
  ScopedToggleError,
  assertScopedToggleAllowed,
  loadScopedToolEvent,
  requireStaffToggleAccess,
  scopedActorAudit,
  scopedModuleIsOn,
  writeScopedModuleSwitch,
  type ScopedToggleActor,
} from "@/modules/event-modules/scoped-toggle";

/**
 * Who the baptism notices of an event go to, and what the Baptism follow-up page shows (#1680). Two kinds of actor, the shared
 * scoped-switch kinds (`scoped-toggle.ts`): staff (a system administrator, an Event Admin of the event or the Clubs
 * Administrator, who is an Event Admin on club events) and an active Area Coordinator on a published club event, after the
 * second sign-in step. Either may switch the module on or off; off hides the tool and keeps every name, status and note.
 */

export class BaptismFollowUpError extends Error {
  constructor(public readonly code: "EVENT_NOT_FOUND" | "MODULE_OFF" | "INVALID_ADDRESSES" | "INVALID_NOTE" | "FOLLOW_UP_NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "BaptismFollowUpError";
  }
}

/** Staff who may change the event lead addresses. Checked here as well as on the page. */
export async function requireBaptismFollowUpStaff(session: Session, eventId: string, lookup: MembershipLookup) {
  return requireStaffToggleAccess(session, eventId, lookup);
}

/** The club event, as this kind of actor may see it: staff also see an unpublished one, a coordinator only a published one. */
export async function loadClubEvent(eventId: string, scope: ScopedToggleActor["kind"] = "staff") {
  try {
    return await loadScopedToolEvent(eventId, scope, "This is not a club event, or it is archived.");
  } catch (error) {
    if (error instanceof ScopedToggleError && error.code === "EVENT_NOT_FOUND") throw new BaptismFollowUpError("EVENT_NOT_FOUND", error.message);
    throw error;
  }
}

export async function baptismFollowUpIsOn(eventId: string): Promise<boolean> {
  return scopedModuleIsOn(eventId, BAPTISM_FOLLOW_UP_MODULE_KEY);
}

/** Switches Baptism follow-up on or off, audited for a real change (the shared scoped switch). Off keeps every name, status and note. */
export async function applyBaptismFollowUpSwitch(actor: ScopedToggleActor, eventId: string, enabled: boolean) {
  await assertScopedToggleAllowed(BAPTISM_FOLLOW_UP_MODULE_KEY, actor);
  await loadClubEvent(eventId, actor.kind);
  await getPrisma().$transaction(async (tx) => {
    await writeScopedModuleSwitch(tx, { actor, eventId, moduleKey: BAPTISM_FOLLOW_UP_MODULE_KEY, enabled });
  });
  return { enabled: await baptismFollowUpIsOn(eventId) };
}

/** Saves the event lead addresses (empty clears them, which stops notices). Audited with the counts and the addresses added and removed. */
export async function saveBaptismLeadEmails(actor: ScopedToggleActor, eventId: string, raw: string | readonly string[]) {
  await assertScopedToggleAllowed(BAPTISM_FOLLOW_UP_MODULE_KEY, actor);
  await loadClubEvent(eventId, actor.kind);
  if (!(await baptismFollowUpIsOn(eventId))) throw new BaptismFollowUpError("MODULE_OFF", "Baptism follow-up is off for this event. Turn it on first.");
  const who = scopedActorAudit(actor);
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
        ...(who.actorUserId ? { actorUserId: who.actorUserId } : {}),
        action: "BAPTISM_FOLLOW_UP_LEADS_CHANGED",
        entityType: "BaptismFollowUpSetting",
        entityId: eventId,
        summary: "Changed who is emailed about baptism follow-up.",
        // The event lead addresses are staff contacts, not attendee data, so who was added and removed is recorded with the counts.
        // No attendee name is ever put in an audit entry.
        metadata: {
          ...who.metadata,
          eventId,
          previousCount: before.length,
          newCount: parsed.emails.length,
          addedEmails: parsed.emails.filter((email) => !before.includes(email)),
          removedEmails: before.filter((email) => !parsed.emails.includes(email)),
        },
      }, tx);
    }
    return { leadEmails: parsed.emails };
  });
}

export type BaptismRecipients = "lead" | "lead and pastor";

export type BaptismClubRow = {
  organizationId: string;
  clubName: string;
  /** The club's church has an active pastor with a usable email (the send path's own test). The address is not returned. */
  pastorOnFile: boolean;
  /** The sponsoring church, for the office's pastor page; null when the club has none. */
  churchId: string | null;
  names: Array<{ id: string; displayName: string; notifiedAt: string; recipients: BaptismRecipients; followedUpAt: string | null; note: string | null }>;
};

export type BaptismFollowUpPage = { enabled: boolean; eventName: string; leadEmails: string[]; clubs: BaptismClubRow[] };

/** What the page shows: the switch, the lead addresses, and the notified names by club. Registered clubs with no pastor on file are listed too. */
export async function loadBaptismFollowUpPage(eventId: string, scope: ScopedToggleActor["kind"] = "staff"): Promise<BaptismFollowUpPage> {
  const event = await loadClubEvent(eventId, scope);
  const prisma = getPrisma();
  const [enabled, setting, rows, registered] = await Promise.all([
    baptismFollowUpIsOn(eventId),
    prisma.baptismFollowUpSetting.findUnique({ where: { eventId }, select: { leadEmails: true } }),
    prisma.baptismFollowUp.findMany({
      where: { eventId },
      orderBy: [{ notifiedAt: "asc" }, { displayName: "asc" }],
      select: { id: true, organizationId: true, displayName: true, notifiedAt: true, pastorNotified: true, followedUpAt: true, followUpNote: true },
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
  // The address is read only to apply the send path's validity test, and is never returned.
  const pastors = churchIds.length === 0
    ? []
    : await prisma.organizationContact.findMany({
      where: { organizationId: { in: churchIds }, kind: "PASTOR", effectiveTo: null, email: { not: null } },
      select: { organizationId: true, email: true },
    });
  const churchesWithPastor = new Set(pastors.filter((pastor) => usablePastorEmail(pastor.email) !== null).map((pastor) => pastor.organizationId));
  const result: BaptismClubRow[] = clubs
    .map((club) => ({
      organizationId: club.id,
      clubName: club.name,
      churchId: club.parentOrganizationId,
      pastorOnFile: club.parentOrganizationId !== null && churchesWithPastor.has(club.parentOrganizationId),
      names: rows
        .filter((row) => row.organizationId === club.id)
        .map((row) => ({
          id: row.id,
          displayName: row.displayName,
          notifiedAt: row.notifiedAt.toISOString(),
          recipients: row.pastorNotified ? "lead and pastor" as const : "lead" as const,
          followedUpAt: row.followedUpAt?.toISOString() ?? null,
          note: row.followUpNote,
        })),
    }))
    .sort((left, right) => left.clubName.localeCompare(right.clubName));
  return { enabled, eventName: event.name, leadEmails: setting?.leadEmails ?? [], clubs: result };
}
