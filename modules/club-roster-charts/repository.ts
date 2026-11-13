import "server-only";

import { formatPersonName } from "@/lib/person-name";
import { getPrisma } from "@/lib/prisma";
import { isClubFeatureEnabled } from "@/modules/club-features/repository";
import {
  CLUB_ROSTER_CHARTS_FEATURE_KEY,
  attendanceByMonth,
  birthdaysInMonth,
  canSeeRosterBirthdays,
  canSeeRosterCharts,
  countByAgeBand,
  countByClassLevel,
  countByMemberType,
  countBySchoolGrade,
  conferenceMonthOf,
  conferenceToday,
  type AttendanceMonth,
  type Birthday,
  type CountRow,
} from "@/modules/club-roster-charts/domain";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubYearDateBounds } from "@/modules/club-meeting-notes/domain";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * Roster charts and birthdays (#1704): aggregate counts for the club's active roster this club year. The callers (the
 * page) have already checked the club role; every function here also needs the feature switched on. Sealed birth dates
 * are opened only here, only for a viewer whose club role already sees birth dates, and only to count age groups and to
 * list month and day. Nothing here writes, and no birth date or age leaves this file.
 */

/** Who is looking: an attendee account, or staff acting as the club's director (#442). */
export type RosterChartsActor = { accountId: string } | { userId: string; actAsId?: string };

async function auditBirthdaysViewed(organizationId: string, clubYear: string, month: number, shown: number, actor: RosterChartsActor) {
  await writeAuditLog({
    ...("userId" in actor ? { actorUserId: actor.userId } : {}),
    action: "CLUB_ROSTER_BIRTHDAYS_VIEWED",
    entityType: "Organization",
    entityId: organizationId,
    summary: "Showed the birthdays page on a club's roster charts.",
    metadata: {
      organizationId,
      clubYear,
      month,
      count: shown,
      ...("accountId" in actor
        ? { actorAttendeeAccountId: actor.accountId }
        : actor.actAsId ? { actAsId: actor.actAsId } : { viewedAsStaff: true }),
    },
  });
}

export type RosterChartsView = {
  clubYear: string;
  peopleCount: number;
  byClassLevel: CountRow[];
  bySchoolGrade: CountRow[];
  byMemberType: CountRow[];
  attendance: AttendanceMonth[];
  /** Null for a viewer who does not see birth dates (registrar): the page then has no age or birthday section at all. */
  birthdayView: { month: number; ageBands: CountRow[]; birthdays: Birthday[] } | null;
};

/** Whether this viewer and club may open the charts: the one check the page and its links share. */
export async function rosterChartsAvailable(organizationId: string, capabilities: Pick<ClubCapabilities, "roster">): Promise<boolean> {
  if (!canSeeRosterCharts(capabilities)) return false;
  return isClubFeatureEnabled(organizationId, CLUB_ROSTER_CHARTS_FEATURE_KEY);
}

export async function loadRosterCharts(
  organizationId: string,
  capabilities: Pick<ClubCapabilities, "roster" | "seeBirthDates">,
  options: { month?: number; actor?: RosterChartsActor } = {},
  now = new Date(),
): Promise<RosterChartsView | null> {
  if (!(await rosterChartsAvailable(organizationId, capabilities))) return null;
  const prisma = getPrisma();
  const clubYear = clubYearFor(now);
  const range = clubYearDateBounds(clubYear);
  const [members, attendanceRows] = await Promise.all([
    prisma.clubRosterMember.findMany({
      where: { organizationId, clubYear, status: "ACTIVE" },
      select: { attendeeType: true, classLevel: true, schoolGrade: true },
    }),
    prisma.clubMeetingAttendance.findMany({
      where: {
        meetingNote: { organizationId, meetingDate: { gte: range.from, lte: range.to } },
        rosterMember: { organizationId, clubYear, status: "ACTIVE" },
      },
      select: { present: true, meetingNote: { select: { id: true, meetingDate: true } } },
    }),
  ]);

  const perMeeting = new Map<string, { meetingDate: string; present: number }>();
  for (const row of attendanceRows) {
    const entry = perMeeting.get(row.meetingNote.id) ?? { meetingDate: row.meetingNote.meetingDate, present: 0 };
    if (row.present) entry.present += 1;
    perMeeting.set(row.meetingNote.id, entry);
  }

  let birthdayView: RosterChartsView["birthdayView"] = null;
  if (canSeeRosterBirthdays(capabilities)) {
    const month = options.month ?? conferenceMonthOf(now);
    const withDates = await prisma.clubRosterMember.findMany({
      where: { organizationId, clubYear, status: "ACTIVE" },
      select: { sealedBirthDate: true, person: { select: { firstName: true, lastName: true } } },
    });
    const opened = withDates.map((member) => ({
      birthDate: member.sealedBirthDate ? openBirthDate(member.sealedBirthDate) : null,
      name: member.person ? formatPersonName(member.person) : null,
    }));
    birthdayView = {
      month,
      ageBands: countByAgeBand(opened.map((person) => person.birthDate), conferenceToday(now)),
      birthdays: birthdaysInMonth(
        opened.flatMap((person) => (person.birthDate && person.name ? [{ name: person.name, birthDate: person.birthDate }] : [])),
        month,
      ),
    };
    // Age groups and month/day together can rebuild a full birth date, so each view that shows birthdays is audited
    // (ADR 0005 Addendum A). The entry holds counts and ids only: no name and no date.
    if (options.actor) await auditBirthdaysViewed(organizationId, clubYear, month, birthdayView.birthdays.length, options.actor);
  }

  return {
    clubYear,
    peopleCount: members.length,
    byClassLevel: countByClassLevel(members),
    bySchoolGrade: countBySchoolGrade(members),
    byMemberType: countByMemberType(members),
    attendance: attendanceByMonth([...perMeeting.values()]),
    birthdayView,
  };
}
