import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { MembershipRecord } from "@/modules/access/authorization";
import { rolePermissions } from "@/modules/access/permissions";

/**
 * Clubs Administrators on club events (#1643, Caleb, 2026-11-07: "They should be able to handle everything that is club
 * events"). An active Clubs Administrator holds the EVENT_ADMIN role's permission set on every event whose audience is
 * CLUB, with no staff assignment, and nowhere else. This file is the one place that rule lives: the membership lookup
 * every event route and page passes to `requirePermission` (`findActiveMembership`), the shell's per-event permission
 * and role maps, the event list and the audit marker all read it. Everything is read from the database on each call,
 * never cached, so a revoke takes effect on the next request. Real memberships still apply: a Clubs Administrator
 * who is also staff on a club event keeps that membership's extra grants (health information, invoice finalizing) and
 * gets the EVENT_ADMIN role on top; on any other event only the real membership counts.
 */

type Client = Prisma.TransactionClient | PrismaClient;

/** The `actorRole` an audit entry carries when the actor had event access only through the Clubs Administrator role. */
export const CLUBS_ADMINISTRATOR_ACTOR_ROLE = "CLUBS_ADMINISTRATOR";

/** Whether this staff user holds an active (not revoked) Clubs Administrator grant (#1225). Read fresh on every call. */
export async function hasActiveClubsAdministratorGrant(userId: string, client: Client = getPrisma()): Promise<boolean> {
  const grant = await client.clubsAdministratorGrant.findFirst({ where: { userId, revokedAt: null }, select: { id: true } });
  return Boolean(grant);
}

/** Whether the event's audience is CLUB, read from the database and never from the request. */
async function isClubEvent(eventId: string, client: Client): Promise<boolean> {
  const event = await client.event.findUnique({ where: { id: eventId }, select: { audience: true } });
  return event?.audience === "CLUB";
}

/** The ids among `eventIds` that are club events this user administers through the Clubs Administrator role; empty for anyone else. */
export async function clubEventIdsAdministeredAsClubsAdministrator(userId: string, eventIds: readonly string[], client: Client = getPrisma()): Promise<Set<string>> {
  if (eventIds.length === 0 || !(await hasActiveClubsAdministratorGrant(userId, client))) return new Set();
  const events = await client.event.findMany({ where: { id: { in: [...eventIds] }, audience: "CLUB" }, select: { id: true } });
  return new Set(events.map((event) => event.id));
}

/** The membership an active Clubs Administrator holds on a club event: EVENT_ADMIN, plus the extra grants of a real active membership. */
export function clubsAdministratorMembership(userId: string, eventId: string, real: MembershipRecord | null): MembershipRecord {
  return {
    eventId,
    userId,
    role: "EVENT_ADMIN",
    status: "ACTIVE",
    permissions: real?.status === "ACTIVE" ? real.permissions : [],
    viaClubsAdministrator: true,
  };
}

/** The permissions a Clubs Administrator holds on a club event: the EVENT_ADMIN set plus a real membership's extra grants. */
export function clubsAdministratorPermissions(realExtra: readonly MembershipRecord["permissions"][number][] = []) {
  return [...new Set([...rolePermissions.EVENT_ADMIN, ...realExtra])];
}

/**
 * The membership this user holds on this event, as the permission checks see it: their real membership, raised to
 * EVENT_ADMIN when they are an active Clubs Administrator and the event is a club event. A real active EVENT_ADMIN
 * membership is returned as it is (no extra query). Null when they hold neither.
 */
export async function findEffectiveMembership(client: Client, userId: string, eventId: string): Promise<MembershipRecord | null> {
  const real = await client.eventMembership.findUnique({
    where: { eventId_userId: { eventId, userId } },
    select: { eventId: true, userId: true, role: true, status: true, permissions: true },
  });
  if (real?.status === "ACTIVE" && real.role === "EVENT_ADMIN") return real;
  if ((await hasActiveClubsAdministratorGrant(userId, client)) && (await isClubEvent(eventId, client))) {
    return clubsAdministratorMembership(userId, eventId, real);
  }
  return real;
}

/**
 * Whether this actor's event access, for this event, comes only through the Clubs Administrator role: an active grant, a
 * club event, no system administrator role and no real active EVENT_ADMIN membership. The audit log marks such actions.
 */
export async function actsViaClubsAdministrator(userId: string, eventId: string, client: Client = getPrisma()): Promise<boolean> {
  if (!(await hasActiveClubsAdministratorGrant(userId, client))) return false;
  const [user, event] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    client.event.findUnique({
      where: { id: eventId },
      select: { audience: true, memberships: { where: { userId, status: "ACTIVE", role: "EVENT_ADMIN" }, select: { id: true }, take: 1 } },
    }),
  ]);
  if (!user || user.globalRole === "SYSTEM_ADMIN" || !event) return false;
  return event.audience === "CLUB" && event.memberships.length === 0;
}
