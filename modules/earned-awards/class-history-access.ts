import "server-only";

import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import type { ClubOrderActor } from "@/modules/club-orders/repository";

/**
 * Who may add, change or remove a person's class history (#1011): the club's
 * roster-capable roles (director, deputy and registrar), through exactly the
 * roster's own gate, `requireRosterAccess` (ADR 0005 Addendum A): their own
 * attendee session, a second step set up and used within the unlock window,
 * and a staff "act as" director resolved the way the roster resolves it. No
 * `need` capability is passed on purpose: Caleb's decision (Oct 18, 2026) is
 * that the registrar edits too. Reporters and Area Coordinators never reach
 * the roster, so they stay view-only.
 */
export async function requireClassHistoryEditAccess(organizationId: string, now = new Date()): Promise<ClubOrderActor> {
  const access = await requireRosterAccess(organizationId, now);
  return actorAttribution(access.actor);
}
