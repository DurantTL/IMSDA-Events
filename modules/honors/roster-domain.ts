import { sortHonorSessions, sortSessionsBySite, type SiteRef } from "./session-order";
import { toCsv } from "@/modules/reporting/csv";

/**
 * Honors Weekend rosters (#360): per class, per site, and per club. Pure
 * layout of records the repository has already loaded. Ages are on the event
 * date; birth dates never reach this module.
 */

export type RosterGroup = "YOUTH" | "STAFF" | "ADULT";

export const rosterGroupLabels: Record<RosterGroup, string> = { YOUTH: "Youth", STAFF: "Staff", ADULT: "Adult" };

/**
 * Anyone not staff or adult is listed with the youth, underage included. This
 * is independent of who takes a class seat (underage attendees don't, #462).
 */
export function rosterGroupOf(attendeeType: string | null | undefined): RosterGroup {
  if (attendeeType === "STAFF") return "STAFF";
  if (attendeeType === "ADULT") return "ADULT";
  return "YOUTH";
}

export type RosterAttendee = {
  id: string;
  firstName: string;
  lastName: string;
  clubId: string;
  clubName: string;
  ageOnEventDate: number | null;
  attendeeType: string | null;
  checkedIn: boolean;
  /** The site the club registered at (#589); null when the event has no locations. */
  locationId?: string | null;
  locationName?: string | null;
  /** Only filled when the viewer may see sensitive answers. */
  dietary: string | null;
};

export type RosterSession = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt?: Date | string | null;
  /** The site (#589); null for a session no site owns. */
  locationId?: string | null;
};

export type RosterOffering = {
  id: string;
  honorName: string;
  honorCode: string;
  span: "SINGLE_SESSION" | "ALL_SESSIONS";
  sessionId: string | null;
  capacity: number;
  teacherName: string;
  location: string;
  isActive: boolean;
  /** The site, from the class's session (#589); null for an all-sessions class or an event with no locations. */
  siteName?: string | null;
  /** The class's per-club limit (#962: the placement form warns when a placement would pass it). */
  perClubLimit?: number | null;
  /** Seat-taking youth holding the class across every site, placements included (#962); a site-filtered roster only lists one site's. */
  seatsAllSites?: number;
  /** Seats counted toward the limit plus seats held for live offers, across every site, placements left out (#962). */
  capacityHeldAllSites?: number;
};

export type RosterEnrollment = {
  offeringId: string;
  attendeeId: string;
  consumesSeat: boolean;
  /** The pick's id, so a system administrator can remove it (#962). */
  id?: string;
  /** Why a system administrator placed the youth although the class was full or closed (#962); null or absent for a normal pick. */
  adminPlacementReason?: string | null;
  /** Whether a system administrator placed it (#962). Every staff viewer's counts know; the reason is only loaded for system administrators. */
  adminPlaced?: boolean;
};

function byName(a: { lastName: string; firstName: string }, b: { lastName: string; firstName: string }) {
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
}

export function sessionLabel(offering: RosterOffering, sessions: readonly RosterSession[]) {
  if (offering.span === "ALL_SESSIONS") return "All sessions";
  return sessions.find((session) => session.id === offering.sessionId)?.name ?? "Session";
}

export function buildClassRosters(
  sessions: readonly RosterSession[],
  offerings: readonly RosterOffering[],
  enrollments: readonly RosterEnrollment[],
  attendees: readonly RosterAttendee[],
  locations: readonly SiteRef[] = [],
) {
  const attendeesById = new Map(attendees.map((attendee) => [attendee.id, attendee]));
  const order = new Map(sortSessionsBySite(sessions, locations).map((session, position) => [session.id, position]));
  const sortKey = (offering: RosterOffering) => (offering.span === "ALL_SESSIONS" ? -1 : order.get(offering.sessionId ?? "") ?? 999);
  return [...offerings]
    .sort((a, b) => sortKey(a) - sortKey(b) || a.honorName.localeCompare(b.honorName))
    .map((offering) => {
      const rows = enrollments.filter((enrollment) => enrollment.offeringId === offering.id);
      const youthSeats = rows.filter((row) => row.consumesSeat).length;
      const adminPlacements = rows.filter((row) => row.consumesSeat && (row.adminPlaced ?? Boolean(row.adminPlacementReason))).length;
      // A site-filtered roster lists one site; the limit is the whole class's.
      const seatsAllSites = offering.seatsAllSites ?? youthSeats;
      const people = rows
        .map((row) => attendeesById.get(row.attendeeId))
        .filter((attendee): attendee is RosterAttendee => Boolean(attendee))
        .sort(byName);
      return {
        offering,
        session: sessionLabel(offering, sessions),
        siteName: offering.siteName ?? null,
        people,
        // Counted from the enrollment rows, exactly as H5 counts taken seats, plus any placed by a system administrator (#962).
        youthSeats,
        /** Seats a system administrator placed on top of the class's limit (#962). */
        adminPlacements,
        /** More youth hold seats than the class's limit, which only a system administrator's placement can cause (#962). */
        seatsAllSites,
        overCapacity: seatsAllSites > offering.capacity,
        /** Each pick with its id and, for a hand placement, its reason (#962). */
        picks: rows
          .filter((row) => attendeesById.has(row.attendeeId))
          .map((row) => ({ enrollmentId: row.id ?? null, attendeeId: row.attendeeId, adminPlaced: row.adminPlaced ?? Boolean(row.adminPlacementReason), adminPlacementReason: row.adminPlacementReason ?? null })),
      };
    });
}

export type ClassRoster = ReturnType<typeof buildClassRosters>[number];

export function buildSiteRoster(attendees: readonly RosterAttendee[]) {
  const people = [...attendees].sort((a, b) => a.clubName.localeCompare(b.clubName) || byName(a, b));
  const totals = { YOUTH: 0, STAFF: 0, ADULT: 0 } satisfies Record<RosterGroup, number>;
  const clubs = new Map<string, { clubName: string; YOUTH: number; STAFF: number; ADULT: number }>();
  for (const person of people) {
    const group = rosterGroupOf(person.attendeeType);
    totals[group] += 1;
    const club = clubs.get(person.clubId) ?? { clubName: person.clubName, YOUTH: 0, STAFF: 0, ADULT: 0 };
    club[group] += 1;
    clubs.set(person.clubId, club);
  }
  return { people, totals: { ...totals, total: people.length }, clubs: [...clubs.values()] };
}

export function buildClubSchedule(
  clubId: string,
  sessions: readonly RosterSession[],
  offerings: readonly RosterOffering[],
  enrollments: readonly RosterEnrollment[],
  attendees: readonly RosterAttendee[],
  locations: readonly SiteRef[] = [],
) {
  const offeringsById = new Map(offerings.map((offering) => [offering.id, offering]));
  const people = attendees.filter((attendee) => attendee.clubId === clubId).sort(byName);
  // A club sees its own site's sessions plus any with no site (#589). A club
  // with no site (an event without locations) sees every session, as before.
  const site = people.find((person) => person.locationId) ?? null;
  const visible = site ? sessions.filter((session) => !session.locationId || session.locationId === site.locationId) : sessions;
  const orderedSessions = locations.length > 0 ? sortSessionsBySite(visible, locations) : sortHonorSessions(visible);
  return {
    siteName: site?.locationName ?? null,
    sessions: orderedSessions,
    people: people.map((person) => {
      const classes = enrollments
        .filter((enrollment) => enrollment.attendeeId === person.id)
        .map((enrollment) => offeringsById.get(enrollment.offeringId))
        .filter((offering): offering is RosterOffering => Boolean(offering));
      const allSessions = classes.find((offering) => offering.span === "ALL_SESSIONS") ?? null;
      const bySession: Record<string, RosterOffering | null> = {};
      for (const session of orderedSessions) {
        bySession[session.id] = allSessions ?? classes.find((offering) => offering.sessionId === session.id) ?? null;
      }
      return { person, bySession, classCount: classes.length };
    }),
  };
}

export type ClubSchedule = ReturnType<typeof buildClubSchedule>;

const age = (value: number | null) => (value === null ? "" : value);

function classPlace(offering: RosterOffering) {
  return [offering.location, offering.teacherName].filter(Boolean).join(" · ");
}

export const allSitesLabel = "All sites";

/** With locations on the event, every export row names its site (#589); without, the columns are unchanged. */
/** `showAdminReasons` adds the column of hand-placement reasons (#962); only system administrators get it. */
export function classRostersCsv(rosters: readonly ClassRoster[], showSite = false, showAdminReasons = false) {
  const rows: Array<Array<string | number>> = [[
    ...(showSite ? ["Site"] : []),
    "Session", "Honor code", "Honor", "Location", "Teacher", "Youth seats", "Capacity",
    "Last name", "First name", "Club", "Age at event", "Type",
    ...(showAdminReasons ? ["Admin placement reason"] : []),
  ]];
  for (const roster of rosters) {
    const head = [
      ...(showSite ? [roster.siteName ?? allSitesLabel] : []),
      roster.session, roster.offering.honorCode, roster.offering.honorName, roster.offering.location, roster.offering.teacherName, roster.youthSeats, roster.offering.capacity,
    ];
    if (roster.people.length === 0) rows.push([...head, "", "", "", "", ...(showAdminReasons ? [""] : [])]);
    const reasonByAttendee = new Map(roster.picks.map((pick) => [pick.attendeeId, pick.adminPlacementReason ?? ""]));
    for (const person of roster.people) {
      rows.push([...head, person.lastName, person.firstName, person.clubName, age(person.ageOnEventDate), rosterGroupLabels[rosterGroupOf(person.attendeeType)], ...(showAdminReasons ? [reasonByAttendee.get(person.id) ?? ""] : [])]);
    }
  }
  return toCsv(rows);
}

export function siteRosterCsv(site: ReturnType<typeof buildSiteRoster>, includeDietary: boolean, showSite = false) {
  const rows: Array<Array<string | number>> = [[
    ...(showSite ? ["Site"] : []),
    "Club", "Last name", "First name", "Age at event", "Type", "Checked in",
    ...(includeDietary ? ["Dietary notes"] : []),
  ]];
  for (const person of site.people) {
    rows.push([
      ...(showSite ? [person.locationName ?? ""] : []),
      person.clubName, person.lastName, person.firstName, age(person.ageOnEventDate),
      rosterGroupLabels[rosterGroupOf(person.attendeeType)], person.checkedIn ? "Yes" : "",
      ...(includeDietary ? [person.dietary ?? ""] : []),
    ]);
  }
  return toCsv(rows);
}

export function clubScheduleCsv(schedule: ClubSchedule, showSite = false) {
  const rows: Array<Array<string | number>> = [[
    ...(showSite ? ["Site"] : []),
    "Last name", "First name", "Age at event", "Type", ...schedule.sessions.map((session) => session.name),
  ]];
  for (const row of schedule.people) {
    rows.push([
      ...(showSite ? [schedule.siteName ?? ""] : []),
      row.person.lastName, row.person.firstName, age(row.person.ageOnEventDate),
      rosterGroupLabels[rosterGroupOf(row.person.attendeeType)],
      ...schedule.sessions.map((session) => {
        const offering = row.bySession[session.id];
        return offering ? [offering.honorName, classPlace(offering)].filter(Boolean).join(" — ") : "";
      }),
    ]);
  }
  return toCsv(rows);
}

/** A dietary answer is any attendee field about food or allergies; the text is kept short for print. */
export const dietaryFieldPattern = /\b(?:diet\w*|food|allerg\w*|vegan|vegetarian|gluten)\b/i;
