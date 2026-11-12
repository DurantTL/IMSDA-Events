import "server-only";

import { getPrisma } from "@/lib/prisma";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import {
  shapeChurchClubSummary,
  type ChurchClubSummary,
} from "@/modules/club-reports/church-club-summary-domain";
import { clubJoinSelect, clubJoinedOn } from "@/modules/club-reports/domain";
import { directorGrantIsActive } from "@/modules/organizations/director-grants-domain";

/**
 * One church's active clubs for a club year (#1711), read only. Every query selects the few fields the summary shows:
 * leader display names and roles (no account email), counts from grouped queries (no roster rows), event names and dates,
 * and Monthly Record statuses. Returns null when the organization is not a church.
 */
export async function getChurchClubSummary(churchId: string, clubYear: string, now = new Date()): Promise<ChurchClubSummary | null> {
  const prisma = getPrisma();
  const church = await prisma.organization.findUnique({ where: { id: churchId }, select: { id: true, name: true, type: true } });
  if (!church || church.type !== "CHURCH") return null;
  const clubs = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true, parentOrganizationId: churchId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, ...clubJoinSelect },
  });
  const clubIds = clubs.map((club) => club.id);
  const yearStart = new Date(`${clubYear.slice(0, 4)}-09-01T00:00:00Z`);
  const yearEnd = new Date(`${Number(clubYear.slice(0, 4)) + 1}-09-01T00:00:00Z`);
  const [reports, memberGroups, adultGroups, grants, registrations] = clubIds.length === 0
    ? [[], [], [], [], []] as const
    : await Promise.all([
      prisma.clubMonthlyReport.findMany({
        where: { clubYear, organizationId: { in: clubIds } },
        select: { organizationId: true, reportMonth: true, status: true, totalPoints: true, onTimePoints: true },
      }),
      prisma.clubRosterMember.groupBy({
        by: ["organizationId"],
        where: { clubYear, status: "ACTIVE", organizationId: { in: clubIds } },
        _count: { _all: true },
      }),
      prisma.clubRosterMember.groupBy({
        by: ["organizationId"],
        where: { clubYear, status: "ACTIVE", attendeeType: { in: ["ADULT", "STAFF"] }, organizationId: { in: clubIds } },
        _count: { _all: true },
      }),
      prisma.clubDirectorGrant.findMany({
        where: {
          organizationId: { in: clubIds },
          revokedAt: null,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        select: { organizationId: true, role: true, effectiveFrom: true, effectiveTo: true, revokedAt: true, attendeeAccount: { select: { displayName: true } } },
      }),
      prisma.clubEventRegistration.findMany({
        where: {
          organizationId: { in: clubIds },
          registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } },
          event: { isPublished: true, audience: "CLUB", endsAt: { gte: yearStart }, startsAt: { lt: yearEnd } },
        },
        select: { organizationId: true, event: { select: { id: true, name: true, startsAt: true, timezone: true } } },
      }),
    ]);
  const members = new Map(memberGroups.map((group) => [group.organizationId, group._count._all]));
  const adults = new Map(adultGroups.map((group) => [group.organizationId, group._count._all]));
  return shapeChurchClubSummary({
    church: { id: church.id, name: church.name },
    clubs: clubs.map((club) => ({
      id: club.id,
      name: club.name,
      joinedOn: clubJoinedOn(club),
      leaders: grants
        .filter((grant) => grant.organizationId === club.id && directorGrantIsActive(grant, now))
        .map((grant) => ({ displayName: grant.attendeeAccount.displayName, role: grant.role })),
      members: members.get(club.id) ?? 0,
      adultsAndStaff: adults.get(club.id) ?? 0,
      events: registrations
        .filter((entry) => entry.organizationId === club.id)
        .map((entry) => entry.event),
      reports: reports.filter((report) => report.organizationId === club.id),
    })),
  }, clubYear, now);
}

export type ChurchClubSummaryResult =
  | { kind: "denied" }
  | { kind: "not-found" }
  | { kind: "ok"; summary: ChurchClubSummary };

/**
 * The gate and the read together, so the page and its tests share one decision: a system administrator or an active
 * Clubs Administrator, exactly as the club page; anyone else is refused before any data is read. Not a church: not found.
 */
export async function loadChurchClubSummary(
  user: Pick<AuthenticatedUser, "id" | "globalRole">,
  churchId: string,
  clubYear: string,
  now = new Date(),
): Promise<ChurchClubSummaryResult> {
  if (!(await hasClubsAdministration(user))) return { kind: "denied" };
  const summary = await getChurchClubSummary(churchId, clubYear, now);
  return summary ? { kind: "ok", summary } : { kind: "not-found" };
}
