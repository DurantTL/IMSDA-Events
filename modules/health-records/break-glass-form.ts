import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { HealthViewer } from "@/modules/health-records/domain";

/**
 * The inline break-glass form on the two pages that show BREAK_GLASS_REQUIRED_MESSAGE (#1617). It follows the break-glass
 * route: any viewer the route accepts, which is a system administrator (acting as a director or not) and a Clubs
 * Administrator (`viaClubsAdministrator`, ADR 0005 Decided 2026-10-26, #1225). A director, deputy, registrar or
 * health-role viewer gets no form. The server stays the authority: the route checks again.
 */
export function canStartBreakGlassInline(viewer: HealthViewer): boolean {
  return viewer.kind === "SYSTEM_ADMIN";
}

/**
 * The roster member's person id, and nothing else about them: the form posts it to the break-glass route. A member
 * with no person (an unlinked roster row) returns null; an administrator can never hold a grant for them (ADR 0005
 * Addendum B), so the page shows no form. No health value is read.
 */
export async function rosterMemberPersonId(organizationId: string, memberId: string): Promise<string | null> {
  const member = await getPrisma().clubRosterMember.findFirst({ where: { id: memberId, organizationId }, select: { personId: true } });
  return member?.personId ?? null;
}
