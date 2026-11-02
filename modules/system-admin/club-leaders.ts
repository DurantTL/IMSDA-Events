import "server-only";

import { clampPage } from "@/lib/pagination";
import { getPrisma } from "@/lib/prisma";
import { accountIdsWithTwoStepOn } from "@/modules/attendee-accounts/two-step-status";
import {
  buildLeadersWhere,
  CLUB_LEADERS_ORDER_BY,
  CLUB_LEADERS_PAGE_SIZE,
  leaderRoleLabel,
  type ClubLeader,
  type ClubLeaderFilters,
} from "@/modules/system-admin/club-leaders-model";

/** Every current Director, Deputy, Registrar and Reporter in CLUB-type organizations (#1277). Read only. */
export async function listClubLeaders(filters: ClubLeaderFilters, requestedPage = 1, now = new Date()): Promise<{ leaders: ClubLeader[]; total: number; page: number; pageSize: number }> {
  const prisma = getPrisma();
  const where = buildLeadersWhere(filters, now) as never;
  // Paged and ordered in the database: a page is a slice of the whole sorted list, not of a capped sample (#1458).
  const total = await prisma.clubDirectorGrant.count({ where });
  const page = clampPage(requestedPage, total, CLUB_LEADERS_PAGE_SIZE);
  const grants = await prisma.clubDirectorGrant.findMany({
    where,
    orderBy: CLUB_LEADERS_ORDER_BY.map((order) => ({ ...order })) as never,
    skip: (page - 1) * CLUB_LEADERS_PAGE_SIZE,
    take: CLUB_LEADERS_PAGE_SIZE,
    select: {
      id: true,
      role: true,
      attendeeAccount: { select: { id: true, displayName: true, email: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  const twoStep = await accountIdsWithTwoStepOn(grants.map((grant) => grant.attendeeAccount.id));
  const leaders = grants.map((grant) => ({
    key: grant.id,
    accountId: grant.attendeeAccount.id,
    name: grant.attendeeAccount.displayName,
    email: grant.attendeeAccount.email,
    clubId: grant.organization.id,
    clubName: grant.organization.name,
    role: grant.role,
    roleLabel: leaderRoleLabel(grant.role),
    twoStepOn: twoStep.has(grant.attendeeAccount.id),
  }));
  return { leaders, total, page, pageSize: CLUB_LEADERS_PAGE_SIZE };
}
