import { monthCell, type MonthStatus } from "@/modules/club-reports/area-summary-domain";
import { clubYearMonths, reportMonthLabel } from "@/modules/club-reports/domain";
import { calendarDateIn } from "@/modules/calendar/domain";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";

/**
 * The staff Church club summary (#1711): one church's clubs for a club year, in counts and names only.
 * Pure shaping over already-loaded rows. The shape below is the whole contract: a leader is a name and a role, a club
 * has counts, event names and dates, and a status for each Monthly Record. It never carries a birth date, health
 * information, a guardian, an email address or a phone number, and `tests/church-club-summary-1711.test.ts` asserts the keys.
 */

export type ChurchClubLeader = { name: string; role: ClubRole; roleLabel: string };
export type ChurchClubEvent = { id: string; name: string; /** The event's first day, `YYYY-MM-DD`, in the event's own time zone. */ date: string };
export type ChurchClubMonth = { month: string; label: string; status: MonthStatus };

export type ChurchClubRow = {
  id: string;
  name: string;
  leaders: ChurchClubLeader[];
  /** Active roster members for the club year. */
  members: number;
  /** Of those, the Adult and Staff roster types. */
  adultsAndStaff: number;
  events: ChurchClubEvent[];
  months: ChurchClubMonth[];
  /** Submitted months, late ones included (the same rule as the Monthly Records summary). */
  sent: number;
  late: number;
  missing: number;
};

export type ChurchClubSummary = { church: { id: string; name: string }; clubYear: string; clubs: ChurchClubRow[] };

export type ChurchClubSummaryInput = {
  church: { id: string; name: string };
  clubs: ReadonlyArray<{
    id: string;
    name: string;
    joinedOn?: string | null;
    leaders: ReadonlyArray<{ displayName: string; role: string }>;
    members: number;
    adultsAndStaff: number;
    events: ReadonlyArray<{ id: string; name: string; startsAt: Date; timezone: string }>;
    reports: ReadonlyArray<{ reportMonth: string; status: "DRAFT" | "SUBMITTED"; totalPoints: number; onTimePoints: number }>;
  }>;
};

const roleOrder: readonly ClubRole[] = ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"];

function isClubRole(role: string): role is ClubRole {
  return (roleOrder as readonly string[]).includes(role);
}

/** Leaders by role (Director first), then by name; a role this screen does not know is left out rather than guessed at. */
export function shapeLeaders(grants: ChurchClubSummaryInput["clubs"][number]["leaders"]): ChurchClubLeader[] {
  return grants
    .filter((grant): grant is { displayName: string; role: ClubRole } => isClubRole(grant.role))
    .map((grant) => ({ name: grant.displayName, role: grant.role, roleLabel: clubDirectorRoleLabels[grant.role] }))
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name));
}

export function shapeChurchClubSummary(input: ChurchClubSummaryInput, clubYear: string, now: Date): ChurchClubSummary {
  const clubs = [...input.clubs]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((club): ChurchClubRow => {
      const byMonth = new Map(club.reports.map((report) => [report.reportMonth, report]));
      const months = clubYearMonths(clubYear).map((month) => {
        const cell = monthCell(month, byMonth.get(month), now, club.joinedOn ?? null);
        return { month, label: reportMonthLabel(month), status: cell.status } satisfies ChurchClubMonth;
      });
      // A club with several registrations for one event (teams) lists the event once.
      const seen = new Set<string>();
      const events = [...club.events]
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.name.localeCompare(b.name))
        .filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)))
        .map((event) => ({ id: event.id, name: event.name, date: calendarDateIn(event.startsAt, event.timezone) }));
      return {
        id: club.id,
        name: club.name,
        leaders: shapeLeaders(club.leaders),
        members: club.members,
        adultsAndStaff: club.adultsAndStaff,
        events,
        months,
        sent: months.filter((cell) => cell.status === "SUBMITTED" || cell.status === "LATE").length,
        late: months.filter((cell) => cell.status === "LATE").length,
        missing: months.filter((cell) => cell.status === "MISSING").length,
      };
    });
  return { church: { id: input.church.id, name: input.church.name }, clubYear, clubs };
}

export const churchClubMonthWords: Record<MonthStatus, string> = {
  SUBMITTED: "Sent",
  LATE: "Sent late",
  DRAFT: "Draft",
  MISSING: "Missing",
  DUE: "Due",
  FUTURE: "Not yet due",
};
