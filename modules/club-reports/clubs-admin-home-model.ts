/**
 * The Clubs Administrator dashboard (#1226): pure model, no database access and no authorization.
 *
 * The caller passes rows that existing reads already returned (`getAreaClubsSummary`, `listAreaClubEvents`,
 * `listNewClubApplications`, `countWaitingNewClubApplications`); this file only derives what the page shows, so every
 * number matches the page it links to for the same club year.
 *
 * Every number says what one unit is:
 * - Active clubs: clubs returned by the summary read, which is every active club (the All clubs page's set).
 * - New club applications waiting: applications with status PENDING, in any year (the applications page's count).
 * - Monthly records submitted: clubs whose Monthly Record for the report month has status SUBMITTED or LATE. A record
 *   has no "reviewed" state, so none is claimed. The report month is the current calendar month (Central time) when it
 *   falls in the selected club year, otherwise that club year's last month.
 * - Registered for next event: clubs whose registration for the next club event is REGISTERED, out of every active
 *   club. The next club event is the first event of the club year whose start date (Central time) is today or later.
 * - People registered: the event's headcount across registered clubs only.
 * - Roster members: active roster members across active clubs, for the selected club year.
 */
import { calendarDateIn, CONFERENCE_TIME_ZONE } from "@/modules/calendar/domain";
import { clubYearMonths, reportMonthLabel } from "@/modules/club-reports/domain";
import {
  eventHeadcount,
  filterClubsByNameChurchOrCity,
  type AreaClubSummary,
  type AreaEventClubRow,
  type MonthStatus,
} from "@/modules/club-reports/area-summary-domain";
import { clubYearFor } from "@/modules/club-rosters/domain";

export const NEW_CLUBS_LIMIT = 5;
export const REGISTERED_CLUBS_LIMIT = 10;
export const EVENT_TOTAL_NOTE = "Only registered clubs count toward an event's total.";
export const NEW_CLUBS_NOTE = "Only the buttons in this list decide an application.";

export type ClubsAdminEventSource = { id: string; name: string; startsAt: string; clubs: AreaEventClubRow[] };

export type ClubsAdminApplicationSource = {
  id: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  clubName: string;
  submittedAt: string;
  otherBoardMembers: readonly string[];
  church: { name: string; needsChoice: boolean };
  director: { email: string };
  /** Flags the applications page shows beside Approve. Any of them means "review first". */
  duplicates?: readonly unknown[];
  invitedEmailDiffers?: boolean;
  sterling?: "CLEAR" | "FLAGGED" | "NOT_COMPLIANT" | "NO_RECORD";
  sterlingAmbiguous?: boolean;
  sterlingNameMismatch?: boolean;
};

export type ClubsAdminTab = { key: string; label: string; href: string };

export type ClubsAdminNewClub = {
  id: string;
  clubName: string;
  churchName: string;
  submittedLabel: string;
  /** "3 board members listed", or null when none are listed. */
  boardMembersLabel: string | null;
  directorEmail: string;
  needsChurchChoice: boolean;
  /** Why this one must be opened before approving (church choice, duplicates, Sterling flags, invite mismatch). Empty means Approve may show. */
  reviewReasons: string[];
  reviewHref: string;
};

export type ClubsAdminClubRow = {
  id: string;
  name: string;
  church: string;
  rosterSize: number;
  recordStatus: MonthStatus | null;
  recordLabel: string;
};

export type ClubsAdminNextEvent = {
  id: string;
  name: string;
  dateLabel: string;
  registeredClubs: number;
  /** Every active club. */
  totalClubs: number;
  people: number;
};

export type ClubsAdminHome = {
  clubYear: string;
  counts: {
    activeClubs: number;
    waitingApplications: number;
    monthlyRecordsSubmitted: number;
  };
  /** "2026-10" and its label, "October 2026". */
  reportMonth: string;
  reportMonthLabel: string;
  nextEvent: ClubsAdminNextEvent | null;
  rosterMembers: number;
  /** Pending applications only, oldest first, at most NEW_CLUBS_LIMIT. */
  newClubs: ClubsAdminNewClub[];
  moreNewClubs: boolean;
  registeredClubs: { rows: ClubsAdminClubRow[]; matchCount: number; total: number };
};

/** What each month status is called beside a club. There is no "Needs review" state, so none is shown. */
export const recordStatusLabels: Record<MonthStatus, string> = {
  SUBMITTED: "Submitted",
  LATE: "Submitted late",
  DRAFT: "Draft",
  DUE: "Due",
  MISSING: "Not submitted",
  FUTURE: "Not yet due",
};

export function recordStatusLabel(status: MonthStatus | null) {
  return status ? recordStatusLabels[status] : "Not yet due";
}

/** The current club year and the three before it, newest first; the selected year is added when it is not among them. */
export function clubYearOptions(selected: string, now: Date) {
  const start = Number(clubYearFor(now).slice(0, 4));
  const years = [0, 1, 2, 3].map((back) => `${start - back}-${String((start - back + 1) % 100).padStart(2, "0")}`);
  return years.includes(selected) ? years : [...years, selected].sort().reverse();
}

/** The month the monthly-records card counts: this month when it is in the club year, else the club year's last month. */
export function chooseReportMonth(clubYear: string, now: Date) {
  const months = clubYearMonths(clubYear);
  const current = calendarDateIn(now).slice(0, 7);
  return months.includes(current) ? current : months[months.length - 1]!;
}

/** The first event whose start date (Central time) is today or later, or null. Events come ordered by start; this does not rely on it. */
export function pickNextEvent<T extends { startsAt: string }>(events: readonly T[], now: Date): T | null {
  const today = calendarDateIn(now);
  const upcoming = events.filter((event) => calendarDateIn(new Date(event.startsAt)) >= today);
  return upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;
}

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function submittedDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: CONFERENCE_TIME_ZONE }).format(new Date(iso));
}

export function applicationReviewReasons(application: ClubsAdminApplicationSource): string[] {
  const reasons: string[] = [];
  if (application.church.needsChoice) reasons.push("choose a church");
  if ((application.duplicates?.length ?? 0) > 0) reasons.push("possible duplicate club");
  if (application.invitedEmailDiffers) reasons.push("director email differs from the invited address");
  if (application.sterling && application.sterling !== "CLEAR") reasons.push("Sterling Volunteers status needs a look");
  if (application.sterlingAmbiguous) reasons.push("director email matches more than one person");
  if (application.sterlingNameMismatch) reasons.push("director email matched a different name");
  return reasons;
}

export function clubsAdminHrefs(clubYear: string) {
  const year = `year=${encodeURIComponent(clubYear)}`;
  return {
    overview: `/admin/clubs?${year}`,
    summary: `/admin/clubs/summary?${year}`,
    reports: `/admin/clubs/reports?${year}`,
    points: `/admin/clubs/summary?${year}#points`,
    clubEvents: `/admin/clubs/summary?${year}#club-events`,
    forms: "/admin/club-forms",
    applications: "/admin/clubs/applications",
    registeredClubs: "#registered-clubs",
  };
}

export function clubsAdminTabs(clubYear: string, waitingApplications: number): ClubsAdminTab[] {
  const href = clubsAdminHrefs(clubYear);
  return [
    { key: "overview", label: "Overview", href: href.overview },
    { key: "all-clubs", label: "All clubs", href: href.summary },
    { key: "monthly-records", label: "Monthly Records", href: href.reports },
    { key: "points", label: "Points", href: href.points },
    { key: "club-events", label: "Club events", href: href.clubEvents },
    { key: "forms", label: "Forms", href: href.forms },
    { key: "new-clubs", label: `New clubs (${waitingApplications})`, href: href.applications },
  ];
}

export function buildClubsAdminHome(input: {
  clubYear: string;
  now: Date;
  clubs: readonly AreaClubSummary[];
  events: readonly ClubsAdminEventSource[];
  applications: readonly ClubsAdminApplicationSource[];
  waitingCount: number;
  query?: string;
}): ClubsAdminHome {
  const { clubYear, now, clubs } = input;
  const month = chooseReportMonth(clubYear, now);
  const statusOf = (club: AreaClubSummary) => club.months.find((cell) => cell.month === month)?.status ?? null;

  const next = pickNextEvent(input.events, now);
  const nextEvent: ClubsAdminNextEvent | null = next
    ? {
        id: next.id,
        name: next.name,
        dateLabel: longDate(next.startsAt),
        registeredClubs: next.clubs.filter((club) => club.status === "REGISTERED").length,
        totalClubs: clubs.length,
        people: eventHeadcount(next.clubs),
      }
    : null;

  const pending = input.applications
    .filter((application) => application.status === "PENDING")
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  const waiting = Math.max(input.waitingCount, pending.length);

  const matches = filterClubsByNameChurchOrCity(
    clubs.map((club) => ({ ...club, sponsoringChurch: club.church })),
    input.query,
  );

  return {
    clubYear,
    counts: {
      activeClubs: clubs.length,
      waitingApplications: input.waitingCount,
      monthlyRecordsSubmitted: clubs.filter((club) => {
        const status = statusOf(club);
        return status === "SUBMITTED" || status === "LATE";
      }).length,
    },
    reportMonth: month,
    reportMonthLabel: reportMonthLabel(month),
    nextEvent,
    rosterMembers: clubs.reduce((sum, club) => sum + club.rosterSize, 0),
    newClubs: pending.slice(0, NEW_CLUBS_LIMIT).map((application) => ({
      id: application.id,
      clubName: application.clubName,
      churchName: application.church.name,
      submittedLabel: submittedDate(application.submittedAt),
      boardMembersLabel: application.otherBoardMembers.length > 0
        ? `${application.otherBoardMembers.length} board ${application.otherBoardMembers.length === 1 ? "member" : "members"} listed`
        : null,
      directorEmail: application.director.email,
      needsChurchChoice: application.church.needsChoice,
      reviewReasons: applicationReviewReasons(application),
      reviewHref: `/admin/clubs/applications#application-${application.id}`,
    })),
    moreNewClubs: waiting > NEW_CLUBS_LIMIT,
    registeredClubs: {
      rows: matches.slice(0, REGISTERED_CLUBS_LIMIT).map((club) => {
        const status = statusOf(club);
        return { id: club.id, name: club.name, church: club.church, rosterSize: club.rosterSize, recordStatus: status, recordLabel: recordStatusLabel(status) };
      }),
      matchCount: matches.length,
      total: clubs.length,
    },
  };
}
