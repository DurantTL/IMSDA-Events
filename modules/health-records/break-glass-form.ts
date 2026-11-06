import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { HealthViewer } from "@/modules/health-records/domain";

/**
 * The inline break-glass form on the two pages that show BREAK_GLASS_REQUIRED_MESSAGE (#1617).
 *
 * Only a real system administrator gets the form. A Clubs Administrator's viewer is also `kind: "SYSTEM_ADMIN"`
 * but carries `viaClubsAdministrator: true`, and the issue keeps this form for system administrators only, so that
 * flag is checked here. A system administrator acting as a club director is still a system administrator and does
 * get it. The server stays the authority: the break-glass route checks again.
 */
export function canStartBreakGlassInline(viewer: HealthViewer): boolean {
  return viewer.kind === "SYSTEM_ADMIN" && !viewer.viaClubsAdministrator;
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
