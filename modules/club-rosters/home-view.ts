/**
 * What the club Home shows (#1166). Pure projections of data the page already
 * loaded for the selected, authorized club and club year: nothing here reads
 * the database, opens a birth date, or decides who may see what (the page and
 * the capability table do that). A count is never turned into work: a task
 * exists only when a saved draft, a roster row, a due Monthly Record or an open
 * event backs it.
 */

import { notBilledLabel, isChurchBilledStatus, type ClubRegistrationStatus } from "@/modules/club-registrations/church-owed";
import { clubRosterAttendeeTypeLabels, clubYearFor, rosterRowMissingFields } from "@/modules/club-rosters/domain";
import type { ClubHomeStep } from "@/modules/club-rosters/home-next-task";
import type { ClubEventSummary } from "@/modules/club-registrations/repository";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";
import { calendarDateIn } from "@/modules/calendar/domain";
import { formatDueDate, isLockedForClub, reportDueDate, reportMonthLabel, reportableMonths } from "@/modules/club-reports/domain";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { formatPersonName } from "@/lib/person-name";

/** A saved, unsubmitted club form (a DRAFT submission): metadata only, never an answer. */
export type ClubHomeFormDraft = { id: string; templateName: string; updatedAt: string };

/** `null`: this role has no club forms. `"ERROR"`: the forms service failed, so the count is unknown, not zero. */
export type ClubHomeFormDrafts = ClubHomeFormDraft[] | "ERROR" | null;

/** The roster fields Home reads: no birth date, only the age the roster already computed. */
export type ClubHomeMember = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  attendeeType: keyof typeof clubRosterAttendeeTypeLabels;
  role: string | null;
  classLevel: string | null;
  gender: string | null;
  age: number | null;
  reportedAge: number | null;
  birthDateNeeded: boolean;
};

/** Where Review roster goes. The roster page's "Details needed" filter belongs to the roster slice (#1167). */
export const ROSTER_DETAILS_NEEDED_QUERY = "filter=details-needed";

export type ClubHomeSummaryItem = {
  key: "roster" | "drafts" | "events";
  label: string;
  /** Null when the number could not be loaded; shown as "Unavailable", never as zero. */
  value: number | null;
  /** What is counted and where it comes from, printed under the number. */
  definition: string;
};

/** A section's data, or the marker that its service failed: the section says so instead of showing zero or crashing the page. */
export type Loaded<T> = T | "ERROR";

export function yearLabel(clubYear: string) {
  return clubYear.replace("-", "–");
}

export function activeMembers<T extends { status: string }>(members: readonly T[]) {
  return members.filter((member) => member.status === "ACTIVE");
}

type EventRegistrationView = Pick<ClubEventSummary, "registration" | "teams" | "multipleTeams" | "startsAt">;

/** Whether a club event holds a registration for this club (one registration, or at least one team). */
export function hasClubRegistration(event: Pick<ClubEventSummary, "registration" | "teams">) {
  return Boolean(event.registration) || event.teams.length > 0;
}

/** The statuses of this club's registrations on the event: its teams on a multi-team event, else its one registration. */
export function registrationStatuses(event: Pick<ClubEventSummary, "registration" | "teams" | "multipleTeams">): ClubRegistrationStatus[] {
  if (event.multipleTeams && event.teams.length > 0) return event.teams.map((team) => team.status as ClubRegistrationStatus);
  return event.registration ? [event.registration.status as ClubRegistrationStatus] : [];
}

/** The club year an event belongs to: the one its start date falls in. */
export function eventClubYear(event: Pick<ClubEventSummary, "startsAt">) {
  return clubYearFor(new Date(event.startsAt));
}

/** Submitted or confirmed registration(s) on an event that starts in the selected club year. Waitlisted, cancelled and unsubmitted ones do not count. */
export function countsAsEventRegistration(event: EventRegistrationView, clubYear: string) {
  return eventClubYear(event) === clubYear && registrationStatuses(event).some((status) => isChurchBilledStatus(status));
}

/**
 * The compact summary: roster people, saved form drafts, event registrations,
 * each with its definition. A section that failed to load shows no number
 * (value null), never zero. `events` is null for a past year: club events are
 * listed for the current year only, so no number is claimed for another one.
 */
export function clubHomeSummary({
  clubYear,
  members,
  formDrafts,
  events,
}: {
  clubYear: string;
  members: Loaded<readonly Pick<ClubHomeMember, "status">[]>;
  formDrafts: ClubHomeFormDrafts;
  events: Loaded<readonly ClubEventSummary[]> | null;
}): ClubHomeSummaryItem[] {
  const items: ClubHomeSummaryItem[] = [
    {
      key: "roster",
      label: "Roster people",
      value: members === "ERROR" ? null : activeMembers(members).length,
      definition: `Active members and staff on the ${yearLabel(clubYear)} club roster.`,
    },
  ];
  if (formDrafts !== null) {
    items.push({
      key: "drafts",
      label: "Saved form drafts",
      value: formDrafts === "ERROR" ? null : formDrafts.length,
      definition: `Club forms started but not submitted for ${yearLabel(clubYear)}. A saved draft is not a submission.`,
    });
  }
  if (events) {
    items.push({
      key: "events",
      label: "Event registrations",
      value: events === "ERROR" ? null : events.filter((event) => countsAsEventRegistration(event, clubYear)).length,
      definition: `Club events starting in the ${yearLabel(clubYear)} club year where your club's registration is Submitted or Confirmed, counting a multi-team event once. Waitlisted and cancelled registrations are not counted.`,
    });
  }
  return items;
}

/** "Age 14", "Age 14 (reported)" for an imported row without a birth date, or "Age not recorded". Never a birth date. */
export function rosterAgeLabel(member: Pick<ClubHomeMember, "age" | "reportedAge">) {
  if (member.age !== null) return `Age ${member.age}`;
  if (member.reportedAge !== null) return `Age ${member.reportedAge} (reported)`;
  return "Age not recorded";
}

export const ROSTER_PREVIEW_LIMIT = 6;

export type ClubHomeRosterPreview = {
  total: number;
  rows: Array<{ id: string; name: string; detail: string; age: string }>;
};

/** The first few active people in roster order (the list is already name-sorted), with a role or type and an age. */
export function clubHomeRosterPreview(members: readonly ClubHomeMember[], limit = ROSTER_PREVIEW_LIMIT): ClubHomeRosterPreview {
  const active = activeMembers(members);
  return {
    total: active.length,
    rows: active.slice(0, limit).map((member) => ({
      id: member.id,
      name: formatPersonName(member) || "Unnamed person",
      detail: member.role?.trim() || clubRosterAttendeeTypeLabels[member.attendeeType],
      age: rosterAgeLabel(member),
    })),
  };
}

/**
 * Active people the roster itself would flag as needing details: `rosterRowMissingFields(member).length > 0`, the roster's own
 * "Missing info" rule (an active person's missing birth date is the birth-date notice's job). The roster slice's
 * `rosterDetailsNeeded` wraps this same rule, so Home's count and the Details needed filter agree.
 */
export function peopleNeedingDetails(members: readonly ClubHomeMember[]) {
  return activeMembers(members).filter((member) => rosterRowMissingFields(member).length > 0).length;
}

function formatChicagoDate(value: string) {
  return formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" });
}

/** One task per saved club-form draft, each a link back into the draft. The wording says it is saved, not submitted. */
export function formDraftSteps(drafts: ClubHomeFormDrafts, base: string): ClubHomeStep[] {
  if (!Array.isArray(drafts)) return [];
  return drafts.map((draft) => ({
    key: `form-draft-${draft.id}`,
    text: `${draft.templateName} is saved as a draft, not submitted.`,
    detail: `Last saved ${formatChicagoDate(draft.updatedAt)}.`,
    href: `${base}/forms/submissions/${draft.id}`,
    action: "Continue form",
    actionContext: draft.templateName,
  }));
}

/** The roster task: an empty roster asks for people; otherwise it only appears when the roster has rows with blank fields. */
export function rosterSteps(members: readonly ClubHomeMember[], base: string): ClubHomeStep[] {
  const active = activeMembers(members);
  if (active.length === 0) {
    return [{ key: "roster", text: "Add your club members to this year's roster.", href: `${base}/roster`, action: "Add people" }];
  }
  const needing = peopleNeedingDetails(members);
  if (needing === 0) return [];
  return [{
    key: "roster-details",
    text: `${needing} ${needing === 1 ? "person needs" : "people need"} details on the roster.`,
    detail: "A gender, class, role or type is blank. Review the roster to see who.",
    href: `${base}/roster?${ROSTER_DETAILS_NEEDED_QUERY}`,
    action: "Review roster",
  }];
}

/**
 * Monthly Records keep their own vocabulary (Open report, due or overdue): last
 * month's record while it can still be filed on time, with its due date as the
 * deadline. `reports` are the club's records for the year, whatever their status.
 */
export function monthlyRecordSteps(
  reports: ReadonlyArray<{ reportMonth: string }>,
  clubYear: string,
  base: string,
  now: Date,
  joinedOn: string | null = null,
): { steps: ClubHomeStep[]; deadlines: Record<string, string> } {
  const steps: ClubHomeStep[] = [];
  const deadlines: Record<string, string> = {};
  const started = new Set(reports.map((report) => report.reportMonth));
  for (const month of reportableMonths(clubYear, now, { joinedOn, keep: started })) {
    if (started.has(month) || isLockedForClub(month, now) || reportDueDate(month).slice(0, 7) !== calendarDateIn(now).slice(0, 7)) continue;
    steps.push({
      key: `report-${month}`,
      text: `The ${reportMonthLabel(month)} Monthly Record is due ${formatDueDate(reportDueDate(month))}.`,
      href: `${base}/records?month=${month}`,
      action: "Open report",
    });
    // A report locks for the club the day after it is due, so only a due-today report is listed; the passed-date wording is a guard.
    const due = reportDueDate(month);
    deadlines[`report-${month}`] = due < calendarDateIn(now) ? `Overdue since ${formatDueDate(due)}` : `Due ${formatDueDate(due)}`;
  }
  return { steps, deadlines };
}

const registrationStatusLabels: Record<ClubRegistrationStatus, string> = {
  DRAFT: "Not submitted",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  CANCELLED: "Cancelled",
};

export type ClubHomeEventCardData = {
  id: string;
  name: string;
  dateLabel: string;
  people: number;
  /** The registration's own status words (never a payment or Monthly Record word). */
  lifecycle: string;
  /** Who pays, in words. Never an amount: the director sees no church debt here. */
  billing: string;
  billedToChurch: boolean;
  href: string;
};

function eventDate(event: Pick<ClubEventSummary, "startsAt" | "endsAt" | "timezone">) {
  const format = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: event.timezone, month: "short", day: "numeric", year: "numeric" });
  const start = format(event.startsAt);
  const end = format(event.endsAt);
  return start === end ? start : `${start} to ${end}`;
}

/**
 * One card per club event this club is registered for. A church-billed event
 * says the church is billed after the event (or why nothing is owed) and never
 * carries an amount, a balance or a Pay now; an attendee-pay event says each
 * person pays their own registration. Both link to the club registration only.
 */
export function clubHomeEventCards(
  events: readonly ClubEventSummary[],
  { base, sponsoringChurch, clubYear }: { base: string; sponsoringChurch: string | null; clubYear: string },
): ClubHomeEventCardData[] {
  return events.filter((event) => hasClubRegistration(event) && eventClubYear(event) === clubYear).map((event) => {
    const statuses = registrationStatuses(event);
    const people = event.multipleTeams && event.teams.length > 0
      ? event.teams.reduce((sum, team) => sum + team.attendeeCount, 0)
      : event.registration?.attendeeCount ?? 0;
    const churchBilled = event.billingMode === "DEFERRED_ORGANIZATION_INVOICE";
    const billedStatus = statuses.find((status) => isChurchBilledStatus(status));
    const lifecycle = event.multipleTeams && event.teams.length > 0
      ? `${event.teams.length} ${event.teams.length === 1 ? "team" : "teams"}: ${[...new Set(statuses.map((status) => registrationStatusLabels[status]))].join(", ")}`
      : statuses[0] ? registrationStatusLabels[statuses[0]] : "Registered";
    // Today `listClubEvents` returns only church-billed events, so the attendee-pay wording below is not reached in
    // production. It stays so that a future attendee-pay club event can never read as billed to the church (or as owing one).
    const billing = !churchBilled
      ? "Each person pays for their own registration. Nothing is billed to your church."
      : billedStatus
        ? `Billed to ${sponsoringChurch ?? "your sponsoring church"} after the event. Nothing to pay here.`
        : statuses[0] ? notBilledLabel(statuses[0]) : "Nothing owed";
    return {
      id: event.id,
      name: event.name,
      dateLabel: eventDate(event),
      people,
      lifecycle,
      billing,
      billedToChurch: churchBilled && Boolean(billedStatus),
      href: `${base}/events/${event.id}`,
    };
  });
}

export type ClubHomeUsefulLink = { key: string; label: string; description: string; href: string };

/** Capability-gated shortcuts. Each is a destination the navigation already lists for the same capability. */
export function clubHomeUsefulLinks({
  base,
  capabilities,
  formsRole,
}: {
  base: string;
  capabilities: ClubCapabilities;
  /** `isClubFormsRole(role)`, passed in so this file stays free of the forms module. */
  formsRole: boolean;
}): ClubHomeUsefulLink[] {
  return [
    ...(capabilities.submitReports
      ? [{ key: "records", label: "Monthly Records", description: "File each month's club report.", href: `${base}/records` }]
      : []),
    ...(formsRole
      ? [{ key: "forms", label: "Club forms", description: "Fill in or send forms for your club's files.", href: `${base}/forms` }]
      : []),
    ...(capabilities.manageTeam
      ? [{ key: "team", label: "Club admins", description: "Who can work in this club's portal.", href: `${base}/club-info#club-team` }]
      : []),
  ];
}
