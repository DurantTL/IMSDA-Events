import "server-only";

import {
  AccessDeniedError,
  effectivePermissions,
  requireEventMembership,
  type MembershipLookup,
  type Session,
} from "@/modules/access/authorization";
import { isClubRegisteredForEvent, resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { resolveEventContext } from "@/modules/events/selection";
import { getPrisma } from "@/lib/prisma";

/**
 * Who may view the Club event reports and print a staff-side club packet
 * (Q1, #411): staff with `VIEW_REPORTS` on this event, or a Pathfinder event
 * manager's view-only oversight of this exact club event (#387). Directors
 * get their own club's packet through a separate, roster-access-gated path
 * (`director-packet.ts`) — never through this function.
 */
export async function resolveClubReportsAccess(requestedEventId?: string) {
  const context = await resolveEventContext(requestedEventId);
  const registeredClubsOnly = limitedToRegisteredClubs(context.user, context.membership);
  if (context.permissions.includes("VIEW_REPORTS")) {
    return { ...context, allowed: true as const, readOnly: false as const, registeredClubsOnly };
  }
  const oversight = await resolveClubOversight(context.event.id);
  return { ...context, allowed: oversight.allowed, readOnly: true as const, registeredClubsOnly };
}

/**
 * An event administrator's role is for this event only, so their club exports cover the clubs registered for it
 * (submitted or confirmed). System administrators, Clubs Administrators (who hold the role through their grant, #1643) and
 * staff who hold report access through another role are not narrowed.
 */
export function limitedToRegisteredClubs(
  user: { globalRole?: string | null },
  membership: { role: string; viaClubsAdministrator?: true } | null | undefined,
) {
  return user.globalRole !== "SYSTEM_ADMIN" && membership?.role === "EVENT_ADMIN" && !membership.viaClubsAdministrator;
}

/** Whether one club's data may be opened or exported by this viewer: always, unless narrowed to registered clubs. */
export async function canOpenClubForReports(access: { registeredClubsOnly: boolean }, eventId: string, organizationId: string) {
  if (!access.registeredClubsOnly) return true;
  return isClubRegisteredForEvent(eventId, organizationId);
}

export function canViewClubReports(permissions: readonly string[]) {
  return permissions.includes("VIEW_REPORTS");
}

/**
 * Session-level equivalent of `resolveClubReportsAccess`, for API routes
 * (CSV downloads, the staff club-pass QR image) that must not redirect on a
 * missing session. Grants access to `VIEW_REPORTS` holders, or to a
 * Pathfinder event manager (#387: an event administrator on this exact
 * CLUB-audience event, #481 — independent of billing mode) — the same two
 * audiences the reports page allows.
 */
export async function requireClubReportsAccess(
  session: Session,
  eventId: string,
  lookup: MembershipLookup,
) {
  const access = await requireEventMembership(session, eventId, lookup);
  const permissions = effectivePermissions(access.user, access.membership);
  const registeredClubsOnly = limitedToRegisteredClubs(access.user, access.membership);
  if (permissions.includes("VIEW_REPORTS")) return { ...access, permissions, registeredClubsOnly };

  const isEventAdmin = access.user.globalRole === "SYSTEM_ADMIN" || access.membership?.role === "EVENT_ADMIN";
  if (isEventAdmin) {
    const event = await getPrisma().event.findUnique({ where: { id: eventId }, select: { audience: true } });
    if (event?.audience === "CLUB") return { ...access, permissions, registeredClubsOnly };
  }
  throw new AccessDeniedError(
    "Report access, or Pathfinder event-manager oversight of this club event, is required.",
    403,
    "PERMISSION_DENIED",
  );
}
