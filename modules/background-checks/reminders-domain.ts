import type { ClubComplianceState } from "@/modules/background-checks/display";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { compareByName, sortRows, type SortDirection, type SortValue } from "@/lib/list-sort";

/**
 * Sterling Volunteers reminders (#1844): the pure rules. Which people need action, how the list is filtered and
 * ordered, and exactly what each email says. No database, no clock and no secrets here, so the preview staff read
 * and the message that goes out are built by the very same functions.
 *
 * The emails say only that action is needed (expiring soon, or not current). They never carry a date, a note, an
 * issue reason or anything from a Sterling report.
 */

/** The link a volunteer follows to complete or renew a check and training. Confirmed in review (#1844). */
export const STERLING_VOLUNTEERS_URL = "https://app.sterlingvolunteers.com/";

/** The anchor on the review panel that the page's "Needs a look" quick filter jumps to. */
export const NEEDS_A_LOOK_ID = "needs-a-look";

/** Reminding the same person about the same club again within this many days asks staff to confirm. */
export const REMINDER_RECENT_DAYS = 7;
/** The most people one Send may cover. */
export const REMINDER_MAX_PEOPLE = 500;
/** Rows per page on the "People to follow up" list. */
export const FOLLOW_UP_PAGE_SIZE = 50;

export const REMINDER_FILTERS = ["expiring", "not-current", "all"] as const;
export type ReminderFilter = typeof REMINDER_FILTERS[number];
export const DEFAULT_REMINDER_FILTER: ReminderFilter = "not-current";

/** The compliance states that can be reminded about; a clear person never is. */
export type ReminderState = Exclude<ClubComplianceState, "CLEAR">;

const FILTER_STATES: Record<ReminderFilter, readonly ClubComplianceState[]> = {
  expiring: ["FLAGGED"],
  "not-current": ["NOT_COMPLIANT", "NO_RECORD"],
  all: ["CLEAR", "FLAGGED", "NOT_COMPLIANT", "NO_RECORD"],
};

export const reminderFilterLabels: Record<ReminderFilter, string> = {
  expiring: "Expiring soon",
  "not-current": "Not current",
  all: "All",
};

export function parseReminderFilter(raw: string | string[] | null | undefined): ReminderFilter {
  return typeof raw === "string" && (REMINDER_FILTERS as readonly string[]).includes(raw) ? (raw as ReminderFilter) : DEFAULT_REMINDER_FILTER;
}

export function stateMatchesFilter(state: ClubComplianceState, filter: ReminderFilter) {
  return FILTER_STATES[filter].includes(state);
}

/** True when staff may remind about this state (everything but clear). */
export function isReminderState(state: ClubComplianceState): state is ReminderState {
  return state !== "CLEAR";
}

export const SORT_KEYS = ["expires", "club", "name"] as const;
export type ReminderSortKey = typeof SORT_KEYS[number];

export type SterlingActionRow = {
  rosterMemberId: string;
  personId: string;
  firstName: string;
  lastName: string;
  name: string;
  organizationId: string;
  clubName: string;
  role: string;
  state: ClubComplianceState;
  statusText: string;
  /** Only when the status comes from a Sterling date, never from a roster mark. */
  expiresOn: string | null;
  /** The latest reminder about this person in this club, as an ISO timestamp. */
  lastRemindedAt: string | null;
  hasOwnEmail: boolean;
  /** The staff club page, at this person's roster row. */
  personHref: string;
};

export function reminderStatusText(state: ClubComplianceState) {
  switch (state) {
    case "CLEAR": return "Current";
    case "FLAGGED": return "Expiring soon";
    case "NOT_COMPLIANT": return "Expired or not in compliance";
    case "NO_RECORD": return "No check on file";
  }
}

/** The expiry date when one is known, else what is missing. */
export function expiryOrMissingText(row: Pick<SterlingActionRow, "state" | "expiresOn">) {
  if (row.expiresOn) return formatCalendarDate(row.expiresOn);
  switch (row.state) {
    case "CLEAR": return "—";
    case "FLAGGED": return "Marked expiring on the roster export";
    case "NOT_COMPLIANT": return "Not in compliance on the roster export";
    case "NO_RECORD": return "No check on file";
  }
}

export function filterRows<T extends { state: ClubComplianceState }>(rows: readonly T[], filter: ReminderFilter) {
  return rows.filter((row) => stateMatchesFilter(row.state, filter));
}

export type ReminderCounts = { expiring: number; notCurrent: number; all: number; current: number };

export function reminderCounts(rows: ReadonlyArray<{ state: ClubComplianceState }>): ReminderCounts {
  const counts = { expiring: 0, notCurrent: 0, all: rows.length, current: 0 };
  for (const row of rows) {
    if (row.state === "FLAGGED") counts.expiring += 1;
    else if (row.state === "NOT_COMPLIANT" || row.state === "NO_RECORD") counts.notCurrent += 1;
    else counts.current += 1;
  }
  return counts;
}

/**
 * The list in the order asked for. Ties (and rows with no value, which always sort last) fall back to club, then last
 * and first name, so the order never wobbles between page loads.
 */
export function sortFollowUpRows(rows: readonly SterlingActionRow[], key: ReminderSortKey, dir: SortDirection) {
  const base = [...rows].sort((a, b) => a.clubName.localeCompare(b.clubName, "en-US") || compareByName(a, b));
  const accessors: Record<ReminderSortKey, (row: SterlingActionRow) => SortValue> = {
    expires: (row) => row.expiresOn,
    club: (row) => row.clubName,
    name: (row) => `${row.lastName}\u0000${row.firstName}`,
  };
  return sortRows(base, key, dir, accessors);
}

// --- What each message says ------------------------------------------------------------------------------------

export type ReminderMessageKind = "DIRECTOR" | "VOLUNTEER";

export type ReminderPerson = {
  rosterMemberId: string;
  personId: string;
  name: string;
  organizationId: string;
  clubName: string;
  state: ReminderState;
  /** The volunteer's own address, when one is on file. */
  ownEmail: string | null;
};

export type ReminderDirector = { email: string; name: string };

export type ReminderMessage = {
  /** Stable within a plan: the same plan always produces the same keys. */
  key: string;
  kind: ReminderMessageKind;
  to: { email: string; name: string };
  /** "Director of <club>" or "Volunteer", as the preview labels the recipient. */
  recipientLabel: string;
  organizationId: string;
  /** Roster members this message is about. */
  rosterMemberIds: string[];
  subject: string;
  bodyText: string;
};

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

export function normalizedAddress(email: string) {
  return email.trim().toLowerCase();
}

const stateWord = (state: ReminderState) => (state === "FLAGGED" ? "expiring soon" : "not current");

const WHAT_TO_DO = [
  "What to do",
  "Each person completes or renews their Sterling Volunteers check and training here:",
  STERLING_VOLUNTEERS_URL,
];

/** One email to one director about one club's selected volunteers. Names and "expiring soon" or "not current" only. */
export function sterlingDirectorEmail(input: {
  directorName: string;
  clubName: string;
  people: ReadonlyArray<{ name: string; state: ReminderState }>;
  clubUrl: string;
}) {
  const expiring = input.people.filter((person) => person.state === "FLAGGED").map((person) => person.name);
  const notCurrent = input.people.filter((person) => person.state !== "FLAGGED").map((person) => person.name);
  const lines = [
    `Hi ${firstNameOf(input.directorName)},`,
    "",
    `Conference staff are reminding ${input.clubName} about Sterling Volunteers checks. These people on your club roster need to take action.`,
    "",
  ];
  if (expiring.length > 0) lines.push("Expiring soon", ...expiring.map((name) => `- ${name}`), "");
  if (notCurrent.length > 0) lines.push("Not current", ...notCurrent.map((name) => `- ${name}`), "");
  lines.push(...WHAT_TO_DO, "", `You can see who still needs a check on your club roster: ${input.clubUrl}`, "", "IMAdventist");
  return { subject: `Sterling Volunteers checks to follow up for ${input.clubName}`, bodyText: lines.join("\n") };
}

/** One email to the volunteer, about themselves only. */
export function sterlingVolunteerEmail(input: { name: string; clubName: string; state: ReminderState }) {
  const lines = [
    `Hi ${firstNameOf(input.name)},`,
    "",
    `Conference staff are reminding you that your Sterling Volunteers check for ${input.clubName} is ${stateWord(input.state)}.`,
    "",
    "What to do",
    "Please complete or renew your Sterling Volunteers check and training here:",
    STERLING_VOLUNTEERS_URL,
    "",
    "If you have already done this, thank you. It can take a little while to show up.",
    "",
    "IMAdventist",
  ];
  return { subject: "Your Sterling Volunteers check needs attention", bodyText: lines.join("\n") };
}

export type ReminderPersonOutcome = {
  rosterMemberId: string;
  personId: string;
  organizationId: string;
  state: ReminderState;
  /** How many director emails mention this person. */
  directorRecipients: number;
  /** Whether the volunteer gets their own email. */
  volunteerEmailed: boolean;
};

export type ReminderPlan = {
  messages: ReminderMessage[];
  outcomes: ReminderPersonOutcome[];
  /** People with no director address and no address of their own: nothing is sent for them. */
  noRecipient: ReminderPerson[];
  /** People reached through a director only. */
  directorOnly: number;
};

/**
 * Who gets what. One email per director address per club (listing that club's people), and one email per volunteer who
 * has an address. An address is compared in lower case: a volunteer whose own address is also a director address for
 * their club gets only the director email. A person in two clubs gets one email of their own.
 */
export function planSterlingReminders(input: {
  people: readonly ReminderPerson[];
  directorsByClub: ReadonlyMap<string, readonly ReminderDirector[]>;
  clubUrl: (organizationId: string) => string;
}): ReminderPlan {
  const messages: ReminderMessage[] = [];
  const outcomes = new Map<string, ReminderPersonOutcome>();
  const noRecipient: ReminderPerson[] = [];

  const byClub = new Map<string, ReminderPerson[]>();
  for (const person of input.people) {
    const list = byClub.get(person.organizationId) ?? [];
    list.push(person);
    byClub.set(person.organizationId, list);
  }

  const directorAddresses = new Map<string, Set<string>>();
  for (const [organizationId, people] of [...byClub.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const seen = new Set<string>();
    const directors: ReminderDirector[] = [];
    for (const director of input.directorsByClub.get(organizationId) ?? []) {
      const address = normalizedAddress(director.email);
      if (!address || seen.has(address)) continue;
      seen.add(address);
      directors.push({ email: address, name: director.name });
    }
    directorAddresses.set(organizationId, seen);
    const clubName = people[0]!.clubName;
    const ordered = [...people].sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.rosterMemberId.localeCompare(b.rosterMemberId));
    for (const director of directors.sort((a, b) => a.email.localeCompare(b.email))) {
      const content = sterlingDirectorEmail({ directorName: director.name, clubName, people: ordered, clubUrl: input.clubUrl(organizationId) });
      messages.push({
        key: `director:${organizationId}:${director.email}`,
        kind: "DIRECTOR",
        to: { email: director.email, name: director.name },
        recipientLabel: `Director of ${clubName}`,
        organizationId,
        rosterMemberIds: ordered.map((person) => person.rosterMemberId),
        ...content,
      });
    }
    for (const person of ordered) {
      outcomes.set(person.rosterMemberId, {
        rosterMemberId: person.rosterMemberId,
        personId: person.personId,
        organizationId,
        state: person.state,
        directorRecipients: directors.length,
        volunteerEmailed: false,
      });
    }
  }

  // The volunteer's own email: one per person, even when they are listed in two clubs.
  const volunteerRows = new Map<string, { own: string; rows: ReminderPerson[] }>();
  for (const person of [...input.people].sort((a, b) => a.rosterMemberId.localeCompare(b.rosterMemberId))) {
    const outcome = outcomes.get(person.rosterMemberId)!;
    const own = person.ownEmail ? normalizedAddress(person.ownEmail) : "";
    const alsoDirector = own !== "" && directorAddresses.get(person.organizationId)?.has(own) === true;
    if (own && !alsoDirector) {
      outcome.volunteerEmailed = true;
      const known = volunteerRows.get(person.personId);
      if (known) known.rows.push(person);
      else volunteerRows.set(person.personId, { own, rows: [person] });
    }
    if (outcome.directorRecipients === 0 && !own) noRecipient.push(person);
  }

  // One email per volunteer, naming every club they are listed in.
  for (const [personId, { own, rows }] of volunteerRows) {
    const first = rows[0]!;
    const clubs = [...new Set(rows.map((row) => row.clubName))];
    const content = sterlingVolunteerEmail({
      name: first.name,
      clubName: joinNames(clubs),
      state: rows.some((row) => row.state !== "FLAGGED") ? "NOT_COMPLIANT" : "FLAGGED",
    });
    messages.push({
      key: `volunteer:${personId}:${own}`,
      kind: "VOLUNTEER",
      to: { email: own, name: first.name },
      recipientLabel: "Volunteer",
      organizationId: first.organizationId,
      rosterMemberIds: rows.map((row) => row.rosterMemberId),
      ...content,
    });
  }

  const resolved = [...outcomes.values()];
  return {
    messages,
    outcomes: resolved,
    noRecipient,
    directorOnly: resolved.filter((outcome) => outcome.directorRecipients > 0 && !outcome.volunteerEmailed).length,
  };
}
