import "server-only";

import { getPrisma } from "@/lib/prisma";
import { accountIdsWithTwoStepOn } from "@/modules/attendee-accounts/two-step-status";
import {
  buildLeadersWhere,
  CLUB_LEADERS_MAX_ROWS,
  leaderRoleLabel,
  sortClubLeaders,
  type ClubLeader,
  type ClubLeaderFilters,
} from "@/modules/system-admin/club-leaders-model";

/** Every current Director, Deputy, Registrar and Reporter in CLUB-type organizations (#1277). Read only. */
export async function listClubLeaders(filters: ClubLeaderFilters, now = new Date()): Promise<ClubLeader[]> {
  const grants = await getPrisma().clubDirectorGrant.findMany({
    where: buildLeadersWhere(filters, now) as never,
    take: CLUB_LEADERS_MAX_ROWS,
    select: {
      id: true,
      role: true,
      attendeeAccount: { select: { id: true, displayName: true, email: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  const twoStep = await accountIdsWithTwoStepOn(grants.map((grant) => grant.attendeeAccount.id));
  return sortClubLeaders(grants.map((grant) => ({
    key: grant.id,
    accountId: grant.attendeeAccount.id,
    name: grant.attendeeAccount.displayName,
    email: grant.attendeeAccount.email,
    clubId: grant.organization.id,
    clubName: grant.organization.name,
    role: grant.role,
    roleLabel: leaderRoleLabel(grant.role),
    twoStepOn: twoStep.has(grant.attendeeAccount.id),
  })));
}
