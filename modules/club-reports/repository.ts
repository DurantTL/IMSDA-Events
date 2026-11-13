import "server-only";

import { conferenceClubWhere } from "@/modules/organizations/area-coordinator-ministries-domain";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { areaReturnAllowsChange, returnedItemKeys, supersedeCurrentReviews } from "@/modules/club-reports/area-review";
import {
  clubReportClosedMessage,
  clubJoinSelect,
  clubJoinedOn,
  clubYearMonths,
  isLockedForClub,
  onTimePoints,
  pickedTotal,
  reportProblems,
  type PickedPoints,
  type ReportHonor,
} from "@/modules/club-reports/domain";
import { lockedChanges, lockedChangesMessage, mayChangeAfterReturn } from "@/modules/club-reports/area-review-domain";
import type { ClubReportInput } from "@/modules/club-reports/schemas";
import { calendarDateIn } from "@/modules/calendar/domain";
import { clubYearFor, rosterIsTltFor, type ClubClassLevel } from "@/modules/club-rosters/domain";
import { loadClubEventPoints, noEventPoints } from "@/modules/event-points/awards";

/**
 * Club monthly report storage (#377). Totals are always worked out here from
 * the picked values and the first submission time; nothing the browser sends
 * is trusted as a total.
 */

export type ClubReportErrorCode =
  | "CLUB_REPORT_LOCKED"
  | "CLUB_REPORT_ITEMS_LOCKED"
  | "CLUB_REPORT_MONTH_INVALID"
  | "CLUB_REPORT_YEAR_INVALID"
  | "CLUB_REPORT_CONFLICT"
  | "CLUB_REPORT_INVALID_POINTS"
  | "CLUB_REPORT_NOT_SUBMITTED"
  | "CLUB_REPORT_NOT_FOUND"
  | "CLUB_NOT_FOUND";

export class ClubReportError extends Error {
  constructor(public readonly code: ClubReportErrorCode, message: string) {
    super(message);
    this.name = "ClubReportError";
  }
}

/** `actAsId` is set for a staff "act as" director (#442). */
export type ClubReportActor = { accountId: string } | { userId: string; actAsId?: string };

const reportSelect = {
  id: true,
  organizationId: true,
  clubYear: true,
  reportMonth: true,
  meetingPlace: true,
  meetingSchedule: true,
  averageAttendance: true,
  pathfinderCount: true,
  tltCount: true,
  staffCount: true,
  investitureDate: true,
  classLevels: true,
  points: true,
  honors: true,
  onTimePoints: true,
  totalPoints: true,
  signatureName: true,
  signedOn: true,
  status: true,
  submittedAt: true,
  firstSubmittedAt: true,
  reviewedAt: true,
  updatedAt: true,
} satisfies Prisma.ClubMonthlyReportSelect;

type StoredReport = Prisma.ClubMonthlyReportGetPayload<{ select: typeof reportSelect }>;

function serializeReport(report: StoredReport) {
  return {
    ...report,
    classLevels: report.classLevels as ClubClassLevel[],
    points: (report.points ?? {}) as PickedPoints,
    honors: (Array.isArray(report.honors) ? report.honors : []) as ReportHonor[],
    submittedAt: report.submittedAt ? report.submittedAt.toISOString() : null,
    firstSubmittedAt: report.firstSubmittedAt ? report.firstSubmittedAt.toISOString() : null,
    /** The "Reviewed" mark (#1246), shown read-only to directors and coordinators. Never set on a draft. */
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    updatedAt: report.updatedAt.toISOString(),
  };
}

export type ClubReportRecord = ReturnType<typeof serializeReport>;

/** What a new report starts from: the club profile's meeting details and this year's roster counts. */
export async function reportPrefill(organizationId: string, now = new Date()) {
  const prisma = getPrisma();
  const clubYear = clubYearFor(now);
  const [profile, members] = await Promise.all([
    prisma.clubProfile.findUnique({ where: { organizationId }, select: { meetingPlace: true, meetingSchedule: true } }),
    prisma.clubRosterMember.findMany({ where: { organizationId, clubYear, status: "ACTIVE" }, select: { attendeeType: true, isTlt: true } }),
  ]);
  return {
    meetingPlace: profile?.meetingPlace ?? "",
    meetingSchedule: profile?.meetingSchedule ?? "",
    pathfinderCount: members.filter((member) => member.attendeeType === "YOUTH" || member.attendeeType === "UNDERAGE").length,
    tltCount: members.filter((member) => rosterIsTltFor(member.attendeeType, member.isTlt)).length,
    staffCount: members.filter((member) => member.attendeeType === "STAFF" || member.attendeeType === "ADULT").length,
  };
}

export async function getClubReport(organizationId: string, reportMonth: string) {
  const report = await getPrisma().clubMonthlyReport.findUnique({
    where: { organizationId_reportMonth: { organizationId, reportMonth } },
    select: reportSelect,
  });
  return report ? serializeReport(report) : null;
}

/**
 * The calendar day a club joined, only for a club created through a new-club application (#1410): its
 * creation date. Imported and other clubs return null and keep every period, as before, because their
 * `createdAt` is an import date, not a join date.
 */
export async function getClubJoinedOn(organizationId: string): Promise<string | null> {
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: clubJoinSelect });
  return club ? clubJoinedOn(club) : null;
}

/** A club's year: every month, its report if any, the year-to-date standing, the event points applied (#1677), and the day it joined (new-club applications only). */
export async function getClubReportYear(organizationId: string, clubYear: string) {
  const prisma = getPrisma();
  const [reports, standing, joinedOn, eventPoints] = await Promise.all([
    prisma.clubMonthlyReport.findMany({ where: { organizationId, clubYear }, select: reportSelect, orderBy: { reportMonth: "asc" } }),
    prisma.clubYearStanding.findUnique({ where: { organizationId_clubYear: { organizationId, clubYear } }, select: { registrationOnTime: true } }),
    getClubJoinedOn(organizationId),
    // Attendance points applied for events (#1677): the club's own total and the event behind each, never a person.
    loadClubEventPoints(clubYear, [organizationId]),
  ]);
  return { reports: reports.map(serializeReport), registrationOnTime: standing?.registrationOnTime ?? false, joinedOn, eventPoints: eventPoints.get(organizationId) ?? noEventPoints };
}

/**
 * Saves a report as a draft or a submission. A club may file a month up to
 * the current one. A never-submitted report may still be submitted late (no
 * on-time points). Once submitted, the club may change or reopen it until the
 * due date; after that, including a reopened draft, only staff (not act-as)
 * can (#640). On-time points come from the first time a report
 * reaches SUBMITTED, and never change on later edits, reopens, or resubmits.
 *
 * One narrow exception (#1701): with Area Coordinator review on for the report's club year and a current returned
 * item, the club may change and resubmit after the due date. Any save as SUBMITTED supersedes the coordinator's
 * current decisions; a draft save keeps them so the director still sees the notes.
 */
export async function saveClubReport(
  organizationId: string,
  reportMonth: string,
  input: ClubReportInput,
  actor: ClubReportActor,
  now = new Date(),
) {
  const clubYear = clubYearFor(new Date(`${reportMonth}-15T12:00:00Z`));
  if (!clubYearMonths(clubYear).includes(reportMonth) || reportMonth > calendarDateIn(now).slice(0, 7)) {
    throw new ClubReportError("CLUB_REPORT_MONTH_INVALID", "Reports can be filed for this month or earlier months only.");
  }
  // A draft may be half finished; the point rules apply when it's submitted (#426).
  const problems = input.status === "SUBMITTED"
    ? reportProblems({ points: input.points, honors: input.honors, classLevels: input.classLevels })
    : [];
  if (problems.length > 0) throw new ClubReportError("CLUB_REPORT_INVALID_POINTS", problems.map((problem) => problem.message).join(" "));

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const club = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, name: true } });
    if (!club || club.type !== "CLUB") throw new ClubReportError("CLUB_NOT_FOUND", "That club could not be found.");
    const existing = await tx.clubMonthlyReport.findUnique({
      where: { organizationId_reportMonth: { organizationId, reportMonth } },
      select: {
        id: true, status: true, firstSubmittedAt: true, submittedAt: true, totalPoints: true, onTimePoints: true, reviewedAt: true,
        meetingPlace: true, meetingSchedule: true, averageAttendance: true, pathfinderCount: true, tltCount: true, staffCount: true,
        investitureDate: true, classLevels: true, points: true, honors: true,
      },
    });
    // A staff "act as" director (#442) gets exactly the club's rules — never
    // the conference office's power to change a report after its due date.
    const isClub = "accountId" in actor || Boolean(actor.actAsId);
    const pastDue = isLockedForClub(reportMonth, now);
    // After the due date a club can no longer change a report it has already
    // submitted, whether it is still SUBMITTED or was reopened to DRAFT (#640).
    // A report that was never submitted can still go in late; a first
    // submission earns no on-time points. Only conference staff (not "act as")
    // can change a closed report.
    let afterAreaReturn = false;
    if (existing?.firstSubmittedAt && isClub && pastDue) {
      const returned = await returnedItemKeys(tx, { id: existing.id, clubYear });
      afterAreaReturn = mayChangeAfterReturn(true, returned.map(() => ({ outcome: "RETURNED" as const })));
      if (!afterAreaReturn) throw new ClubReportError("CLUB_REPORT_LOCKED", clubReportClosedMessage(reportMonth));
      // Only the returned items can change now (#1701); a draft save follows the same rule. The signature may always change.
      const locked = lockedChanges(
        { ...existing, classLevels: existing.classLevels as string[], points: (existing.points ?? {}) as PickedPoints, honors: (Array.isArray(existing.honors) ? existing.honors : []) as ReportHonor[] },
        input,
        returned,
      );
      if (locked.length > 0) throw new ClubReportError("CLUB_REPORT_ITEMS_LOCKED", lockedChangesMessage(locked));
    }
    const becomingSubmittedNow = input.status === "SUBMITTED" && !existing?.firstSubmittedAt;
    const firstSubmittedAt = input.status === "SUBMITTED" ? (existing?.firstSubmittedAt ?? now) : (existing?.firstSubmittedAt ?? null);
    const onTime = input.status === "SUBMITTED" && firstSubmittedAt ? onTimePoints(reportMonth, firstSubmittedAt) : 0;
    const points: PickedPoints = Object.fromEntries(Object.entries(input.points).filter(([, value]) => value !== undefined));
    const honors = input.honors.filter((honor) => honor.name.trim() || honor.participants !== null);
    const data = {
      clubYear,
      meetingPlace: input.meetingPlace,
      meetingSchedule: input.meetingSchedule,
      averageAttendance: input.averageAttendance,
      pathfinderCount: input.pathfinderCount,
      tltCount: input.tltCount,
      staffCount: input.staffCount,
      investitureDate: input.investitureDate,
      classLevels: input.classLevels,
      points,
      honors,
      onTimePoints: onTime,
      totalPoints: onTime + pickedTotal(points),
      signatureName: input.signatureName,
      signedOn: input.signedOn,
      status: input.status,
      submittedAt: input.status === "SUBMITTED" ? (existing?.status === "SUBMITTED" ? existing.submittedAt : now) : null,
      firstSubmittedAt,
      // Any change or resubmission needs a fresh look, so the mark is cleared (#1246).
      reviewedAt: null,
      reviewedByUserId: null,
      ...("accountId" in actor && becomingSubmittedNow ? { submittedByAccountId: actor.accountId } : {}),
      ...("accountId" in actor
        ? { updatedByAccountId: actor.accountId, updatedByUserId: null }
        : { updatedByUserId: actor.userId, updatedByAccountId: null }),
    };
    const saved = existing
      ? await tx.clubMonthlyReport.update({ where: { id: existing.id }, data, select: reportSelect })
      : await tx.clubMonthlyReport.create({ data: { ...data, organizationId, reportMonth }, select: reportSelect });
    // A save that leaves the record SUBMITTED needs a fresh look from the coordinator (#1701).
    const supersededDecisions = existing && input.status === "SUBMITTED" ? await supersedeCurrentReviews(tx, existing.id, now) : 0;
    const action = input.status === "DRAFT" ? "CLUB_REPORT_DRAFT_SAVED" : becomingSubmittedNow ? "CLUB_REPORT_SUBMITTED" : "CLUB_REPORT_UPDATED";
    await writeAuditLog({
      ...("userId" in actor ? { actorUserId: actor.userId } : {}),
      action,
      entityType: "ClubMonthlyReport",
      entityId: saved.id,
      summary: `${input.status === "DRAFT" ? "Saved a draft of" : becomingSubmittedNow ? "Submitted" : "Updated"} the ${reportMonth} monthly report for ${club.name}.`,
      metadata: {
        organizationId,
        reportMonth,
        reportId: saved.id,
        status: input.status,
        totalPoints: saved.totalPoints,
        onTimePoints: saved.onTimePoints,
        ...(existing?.status === "SUBMITTED"
          ? { previousTotalPoints: existing.totalPoints, previousOnTimePoints: existing.onTimePoints }
          : {}),
        ...(existing?.reviewedAt ? { reviewCleared: true } : {}),
        ...(afterAreaReturn ? { afterAreaReturn: true } : {}),
        ...(supersededDecisions > 0 ? { areaDecisionsSuperseded: supersededDecisions } : {}),
        ...(!isClub && pastDue && input.status === "SUBMITTED" && existing?.firstSubmittedAt && existing.status === "DRAFT"
          ? { resubmittedAfterDueDate: true }
          : {}),
        ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : actor.actAsId ? { actAsId: actor.actAsId } : {}),
      },
    }, tx);
    return serializeReport(saved);
  });
}

/**
 * Reopens a SUBMITTED report to DRAFT so a director can change it (#426).
 * Allowed until the report's due date — the same rule that already locks a
 * club out of editing (`isLockedForClub`); after that only staff can act, except
 * for a record with a current returned item (#1701).
 * `firstSubmittedAt` and any on-time credit already earned stay untouched.
 */
export async function reopenClubReport(organizationId: string, reportMonth: string, actor: ClubReportActor, now = new Date()) {
  const pastDue = isLockedForClub(reportMonth, now);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    // After the due date, only a record with a current returned item (switch on, #1701) can be reopened.
    let afterAreaReturn = false;
    if (pastDue) {
      const report = await tx.clubMonthlyReport.findUnique({ where: { organizationId_reportMonth: { organizationId, reportMonth } }, select: { id: true } });
      afterAreaReturn = report ? await areaReturnAllowsChange(tx, { id: report.id, clubYear: clubYearFor(new Date(`${reportMonth}-15T12:00:00Z`)) }) : false;
      if (!afterAreaReturn) throw new ClubReportError("CLUB_REPORT_LOCKED", clubReportClosedMessage(reportMonth));
    }
    const club = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, name: true } });
    if (!club || club.type !== "CLUB") throw new ClubReportError("CLUB_NOT_FOUND", "That club could not be found.");
    const existing = await tx.clubMonthlyReport.findUnique({
      where: { organizationId_reportMonth: { organizationId, reportMonth } },
      select: { id: true, status: true, reviewedAt: true },
    });
    if (!existing) throw new ClubReportError("CLUB_REPORT_NOT_FOUND", "That report could not be found.");
    if (existing.status !== "SUBMITTED") throw new ClubReportError("CLUB_REPORT_NOT_SUBMITTED", "This report is already a draft.");
    const saved = await tx.clubMonthlyReport.update({
      where: { id: existing.id },
      data: "accountId" in actor
        ? { status: "DRAFT", submittedAt: null, reviewedAt: null, reviewedByUserId: null, updatedByAccountId: actor.accountId, updatedByUserId: null }
        : { status: "DRAFT", submittedAt: null, reviewedAt: null, reviewedByUserId: null, updatedByUserId: actor.userId, updatedByAccountId: null },
      select: reportSelect,
    });
    await writeAuditLog({
      ...("userId" in actor ? { actorUserId: actor.userId } : {}),
      action: "CLUB_REPORT_REOPENED",
      entityType: "ClubMonthlyReport",
      entityId: saved.id,
      summary: `Reopened the ${reportMonth} monthly report for ${club.name} as a draft.`,
      metadata: {
        organizationId,
        reportMonth,
        reportId: saved.id,
        totalPoints: saved.totalPoints,
        onTimePoints: saved.onTimePoints,
        ...(existing.reviewedAt ? { reviewCleared: true } : {}),
        ...(afterAreaReturn ? { afterAreaReturn: true } : {}),
        ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : actor.actAsId ? { actAsId: actor.actAsId } : {}),
      },
    }, tx);
    return serializeReport(saved);
  });
}

/**
 * The conference view (#377): every active club, its reports for the year,
 * and its standing. Only SUBMITTED reports show — a club's own draft is not
 * shown to staff or an Area Coordinator as filed (#426).
 */
export async function listClubReportsForYear(clubYear: string) {
  const prisma = getPrisma();
  const [clubs, reports, standings, eventPoints] = await Promise.all([
    prisma.organization.findMany({
      where: conferenceClubWhere(),
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentOrganization: { select: { name: true } }, ...clubJoinSelect },
    }),
    prisma.clubMonthlyReport.findMany({
      where: { clubYear, status: "SUBMITTED" },
      select: { organizationId: true, reportMonth: true, totalPoints: true, onTimePoints: true, firstSubmittedAt: true, reviewedAt: true },
    }),
    prisma.clubYearStanding.findMany({ where: { clubYear }, select: { organizationId: true, registrationOnTime: true } }),
    // Attendance points applied for events (#1677), so Year to date matches the points boards.
    loadClubEventPoints(clubYear),
  ]);
  const onTimeByClub = new Map(standings.map((standing) => [standing.organizationId, standing.registrationOnTime]));
  return clubs.map((club) => ({
    id: club.id,
    name: club.name,
    church: club.parentOrganization?.name ?? "",
    registrationOnTime: onTimeByClub.get(club.id) ?? false,
    /** Attendance points from events (#1677), part of Year to date. A count only. */
    eventPoints: eventPoints.get(club.id)?.total ?? 0,
    /** The day it joined, for a club made through a new-club application; null otherwise. */
    joinedOn: clubJoinedOn(club),
    reports: Object.fromEntries(reports
      .filter((report) => report.organizationId === club.id)
      .map((report) => [report.reportMonth, { totalPoints: report.totalPoints, onTime: report.onTimePoints > 0, reviewed: Boolean(report.reviewedAt) }])) as Record<string, { totalPoints: number; onTime: boolean; reviewed: boolean }>,
  }));
}

export type ClubYearSummary = Awaited<ReturnType<typeof listClubReportsForYear>>[number];

export async function setRegistrationOnTime(organizationId: string, clubYear: string, registrationOnTime: boolean, actorUserId: string) {
  const prisma = getPrisma();
  const club = await prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
  if (!club || club.type !== "CLUB") throw new ClubReportError("CLUB_NOT_FOUND", "That club could not be found.");
  await prisma.clubYearStanding.upsert({
    where: { organizationId_clubYear: { organizationId, clubYear } },
    create: { organizationId, clubYear, registrationOnTime, updatedByUserId: actorUserId },
    update: { registrationOnTime, updatedByUserId: actorUserId },
  });
  await writeAuditLog({
    actorUserId,
    action: "CLUB_REGISTRATION_STANDING_SET",
    entityType: "Organization",
    entityId: organizationId,
    summary: `Marked the ${clubYear} yearly registration as ${registrationOnTime ? "on time" : "not on time"}.`,
    metadata: { organizationId, clubYear, registrationOnTime },
  });
}
