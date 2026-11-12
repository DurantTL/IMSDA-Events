import { getPrisma } from "@/lib/prisma";
import { completedHonorsCount, clubRecordsCounts, type ClubCardCounts } from "@/modules/club-reports/club-card-status-domain";
import { clubJoinSelect, clubJoinedOn } from "@/modules/club-reports/domain";
import type { ClubLinksViewer } from "@/modules/club-reports/club-page-links";

/**
 * The counts behind the "This club" card statuses (#1587), for one club and club year. Each read runs only when the viewer
 * can see that card (the same gates as `clubRelatedCards`), selects counts and ids only (no names or other personal data),
 * and fails on its own: a failed read is `null`, so that card says "Unavailable" and the page still renders.
 */
export async function loadClubCardStatuses(
  organizationId: string,
  clubYear: string,
  viewer: ClubLinksViewer & { clubActive?: boolean },
  now: Date = new Date(),
): Promise<ClubCardCounts> {
  const prisma = getPrisma();
  const safe = async <T,>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };
  const counts: ClubCardCounts = {};
  const jobs: Promise<void>[] = [];
  if (viewer.canAdministerClub) {
    // The directors page's current list: not revoked, started, and not ended (`directorGrantStatus` ACTIVE).
    jobs.push(safe(() => prisma.clubDirectorGrant.count({
      where: { organizationId, revokedAt: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    })).then((value) => { counts.admins = value; }));
    jobs.push(safe(async () => {
      const members = await prisma.clubRosterMember.findMany({
        where: { organizationId, clubYear, status: "ACTIVE", personId: { not: null } },
        select: { personId: true },
      });
      const personIds = members.map((member) => member.personId!);
      if (personIds.length === 0) return 0;
      const entries = await prisma.memberHonorEntry.findMany({
        where: { personId: { in: personIds } },
        orderBy: { seq: "desc" },
        select: { personId: true, honorId: true, status: true, void: { select: { id: true } } },
      });
      return completedHonorsCount(entries.map((entry) => ({ personId: entry.personId, honorId: entry.honorId, status: entry.status, voided: entry.void !== null })));
    }).then((value) => { counts.honors = value; }));
  }
  if (viewer.clubsAdministration && viewer.clubActive !== false) {
    jobs.push(safe(async () => {
      const [reports, club] = await Promise.all([
        prisma.clubMonthlyReport.findMany({ where: { organizationId, clubYear, status: "SUBMITTED" }, select: { reportMonth: true } }),
        prisma.organization.findUnique({ where: { id: organizationId }, select: clubJoinSelect }),
      ]);
      if (!club) throw new Error("club not found");
      return clubRecordsCounts({ clubYear, submittedMonths: reports.map((report) => report.reportMonth), joinedOn: clubJoinedOn(club), now });
    }).then((value) => { counts.records = value; }));
  }
  await Promise.all(jobs);
  return counts;
}
