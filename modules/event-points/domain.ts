import { z } from "zod";

/**
 * Attendance points (#1677), pure rules and no database: who counts as representing a club at an event, and why a club
 * did or didn't earn the event's points. The rules are the ones the Area Coordinators voted on Nov 8, 2026:
 *   - directors and staff count for their club whatever other role they hold (Area Coordinator, TLT director);
 *   - TLTs count for their club, with a supervising adult present if they are under 18;
 *   - an Area Coordinator's children don't count as club representatives;
 *   - an event marked "needs Pathfinders" (a camporee) pays only when a Pathfinder was present: leaders alone don't earn it;
 *   - the count is from check-in when the event used check-in, otherwise from registration.
 * Staff can override one club, with a reason. Nothing here touches Monthly Records points.
 */

export const ATTENDANCE_POINTS_MAX = 100_000;

export type PointsBasis = "CHECK_IN" | "REGISTRATION";
export const basisLabels: Record<PointsBasis, string> = {
  CHECK_IN: "Counted from check-in",
  REGISTRATION: "Counted from registration (this event did not use check-in)",
};

export type PointsRole = "Pathfinder" | "TLT" | "Staff" | "Child";

/** One registered person, reduced to what the rules read. Names are carried only so staff can read the review list. */
export type PointsPerson = {
  id: string;
  name: string;
  /** The role on the registration (or, when it has none, the club roster's type). Null when neither says. */
  role: PointsRole | null;
  /** The club roster says this person is a director (a free-text role), whatever type the registration gave them. */
  isDirector: boolean;
  /** Age on the event date, or null when not known. */
  age: number | null;
  checkedIn: boolean;
  /** Staff marked this person as an Area Coordinator's child. */
  marked: boolean;
};

export type PersonKind = "leader" | "tlt" | "pathfinder" | "other";

export type PersonVerdict = { id: string; kind: PersonKind; counted: boolean; reason: string };

export type PointsRule = { basis: PointsBasis; requiresPathfinders: boolean; points: number };

export type ClubOverride = { outcome: "AWARD" | "WITHHOLD"; reason: string };

export type ClubVerdict = {
  /** Registered people, and how many were present on the chosen basis. */
  registered: number;
  present: number;
  /** Counted as representing the club, by kind. */
  leaders: number;
  tlts: number;
  pathfinders: number;
  people: PersonVerdict[];
  /** What the rules alone say, and why. */
  computed: { earns: boolean; reason: string };
  override: ClubOverride | null;
  /** What applies: the override when there is one, else the rules' answer. */
  earns: boolean;
  points: number;
  reason: string;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function isLeader(person: PointsPerson) {
  return person.role === "Staff" || person.isDirector;
}

function isAdultKnown(person: PointsPerson) {
  return person.age === null || person.age >= 18;
}

/** Judges each person on the club's registration, in the order the rules are written. */
export function judgePeople(people: readonly PointsPerson[], basis: PointsBasis): PersonVerdict[] {
  const present = (person: PointsPerson) => basis === "REGISTRATION" || person.checkedIn;
  // A supervising adult is a counted director or staff member who is an adult.
  const supervised = people.some((person) => isLeader(person) && present(person) && isAdultKnown(person));
  return people.map((person): PersonVerdict => {
    const kind: PersonKind = isLeader(person) ? "leader" : person.role === "TLT" ? "tlt" : person.role === "Pathfinder" ? "pathfinder" : "other";
    if (!present(person)) return { id: person.id, kind, counted: false, reason: "Registered but not checked in." };
    // Directors and staff come first: nothing else they hold (Area Coordinator, TLT director, a mark) takes this away.
    if (kind === "leader") return { id: person.id, kind, counted: true, reason: "Director or staff. Counts whatever other role they hold." };
    if (person.marked) return { id: person.id, kind, counted: false, reason: "Area Coordinator's child. Doesn't count as a club representative." };
    if (kind === "tlt") {
      const adult = person.age !== null && person.age >= 18;
      if (adult) return { id: person.id, kind, counted: true, reason: "TLT, 18 or older." };
      const ageNote = person.age === null ? " (age not known)" : "";
      return supervised
        ? { id: person.id, kind, counted: true, reason: `TLT with a supervising adult present${ageNote}.` }
        : { id: person.id, kind, counted: false, reason: `TLT under 18 with no supervising adult present${ageNote}.` };
    }
    if (kind === "pathfinder") return { id: person.id, kind, counted: true, reason: "Pathfinder." };
    if (person.role === "Child") return { id: person.id, kind, counted: false, reason: "Child, not a Pathfinder." };
    return { id: person.id, kind, counted: false, reason: "No role on the registration." };
  });
}

function representedText(leaders: number, tlts: number, pathfinders: number) {
  const parts = [
    leaders > 0 ? plural(leaders, "director or staff member", "directors or staff") : "",
    tlts > 0 ? plural(tlts, "TLT") : "",
    pathfinders > 0 ? plural(pathfinders, "Pathfinder") : "",
  ].filter(Boolean);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Works out one club: who counted, whether the rules give it the points, and the reason in plain words. */
export function evaluateClub(rule: PointsRule, club: { people: readonly PointsPerson[]; override: ClubOverride | null }): ClubVerdict {
  const verdicts = judgePeople(club.people, rule.basis);
  const counted = (kind: PersonKind) => verdicts.filter((verdict) => verdict.counted && verdict.kind === kind).length;
  const leaders = counted("leader");
  const tlts = counted("tlt");
  const pathfinders = counted("pathfinder");
  const present = club.people.filter((person) => rule.basis === "REGISTRATION" || person.checkedIn).length;
  const total = leaders + tlts + pathfinders;

  let computed: ClubVerdict["computed"];
  if (total === 0) {
    computed = {
      earns: false,
      reason: rule.basis === "CHECK_IN" && present === 0
        ? `No points: ${plural(club.people.length, "person", "people")} registered, nobody checked in.`
        : "No points: nobody counted as representing the club.",
    };
  } else if (rule.requiresPathfinders && pathfinders === 0) {
    computed = { earns: false, reason: `No points: this event needs Pathfinders present, and only ${tlts > 0 && leaders > 0 ? "leaders and TLTs" : tlts > 0 ? "TLTs" : "leaders"} counted.` };
  } else {
    computed = { earns: true, reason: `Represented by ${representedText(leaders, tlts, pathfinders)}.` };
  }

  const override = club.override;
  const earns = override ? override.outcome === "AWARD" : computed.earns;
  return {
    registered: club.people.length,
    present,
    leaders,
    tlts,
    pathfinders,
    people: verdicts,
    computed,
    override,
    earns,
    points: earns ? rule.points : 0,
    reason: override ? `Staff ${override.outcome === "AWARD" ? "awarded" : "withheld"} the points: ${override.reason}` : computed.reason,
  };
}

/** Typed points ("1,500", "1500") as a whole number, or the problem in plain words. */
export function parsePointsText(text: string): { ok: true; points: number } | { ok: false; message: string } {
  const value = text.trim().replace(/,/g, "");
  if (value === "") return { ok: false, message: "Enter the points a club earns, such as 1,500." };
  if (!/^\d{1,6}$/.test(value)) return { ok: false, message: "Enter a whole number of points, such as 1,500." };
  const points = Number(value);
  if (points < 1) return { ok: false, message: "Points must be at least 1." };
  if (points > ATTENDANCE_POINTS_MAX) return { ok: false, message: `Points can be at most ${ATTENDANCE_POINTS_MAX.toLocaleString("en-US")}.` };
  return { ok: true, points };
}

export const MAX_OVERRIDE_REASON = 300;

/**
 * One request shape for every action, so a staff route and an Area Coordinator route share a handler. The server decides
 * which actions the caller may take.
 */
export const attendancePointsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), enabled: z.boolean() }).strict(),
  z.object({
    action: z.literal("saveSettings"),
    points: z.number().int().min(1, "Points must be at least 1.").max(ATTENDANCE_POINTS_MAX, `Points can be at most ${ATTENDANCE_POINTS_MAX.toLocaleString("en-US")}.`),
    requiresPathfinders: z.boolean(),
  }).strict(),
  z.object({ action: z.literal("markChild"), attendeeId: z.string().trim().min(1).max(64), marked: z.boolean() }).strict(),
  z.object({
    action: z.literal("override"),
    organizationId: z.string().trim().min(1).max(64),
    /** Null takes the override away, so the rules decide again. */
    outcome: z.enum(["AWARD", "WITHHOLD"]).nullable(),
    reason: z.string().trim().max(MAX_OVERRIDE_REASON, `Keep the reason to ${MAX_OVERRIDE_REASON} characters.`),
  }).strict(),
  z.object({ action: z.literal("apply") }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
]);
export type AttendancePointsAction = z.infer<typeof attendancePointsActionSchema>;

export type PointsCapabilities = {
  canSwitch: boolean;
  canSetUp: boolean;
  /** Sees the people on the review list. Names are for staff only. */
  canSeeNames: boolean;
  canMark: boolean;
  canOverride: boolean;
  canApply: boolean;
};

/** The points a club holds for events in a club year, with the event as the reason. Counts only, never people. */
export type ClubEventPoints = { total: number; awards: Array<{ eventName: string; points: number }> };
