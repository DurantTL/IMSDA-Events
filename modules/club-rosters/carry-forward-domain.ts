import { z } from "zod";
import {
  clubYearFor,
  defaultRosterRole,
  rosterRoleOrDefault,
  type ClubClassLevel,
} from "@/modules/club-rosters/domain";

/**
 * Carrying a club's roster forward to the next club year (#414). Pure rules:
 * which two club years are involved, how a carried person's role and class
 * follow a change of type, and the request shape. Nothing here touches a
 * birth date.
 */

function clubYearLabel(startYear: number) {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export type CarryForwardYears = {
  /** The year whose active people are listed. Read-only history once carried. */
  fromClubYear: string;
  /** The year the carried people are added to. */
  toClubYear: string;
};

/**
 * The pair of years a carry-forward moves between. In August, the last month
 * of a club year, it prepares the next year (current to next). From September
 * the next year is the current one, so a club that is late still carries last
 * year's people into the current year (previous to current). No date
 * rolls anything over by itself: only a director's confirmation does.
 */
export function carryForwardYears(now: Date): CarryForwardYears {
  const current = clubYearFor(now);
  const startYear = Number(current.slice(0, 4));
  if (now.getUTCMonth() + 1 === 8) return { fromClubYear: current, toClubYear: clubYearLabel(startYear + 1) };
  return { fromClubYear: clubYearLabel(startYear - 1), toClubYear: current };
}

/** Staff and Area Coordinators watch for clubs that haven't started from August through October. */
export function carryForwardOversightOpen(now: Date) {
  const month = now.getUTCMonth() + 1;
  return month === 8 || month === 9 || month === 10;
}

/**
 * The role a carried person gets. A role the director typed is used (blank
 * falls back to the new type's default). An untouched role stays, except that
 * a type change re-defaults the old type's default role ("Pathfinder" for a
 * youth who becomes staff), the same rule as editing a person on the roster.
 */
export function carriedRole(
  previous: { attendeeType: string; role: string | null },
  next: { attendeeType: string; role?: string },
) {
  if (next.role !== undefined) return rosterRoleOrDefault(next.role, next.attendeeType);
  const oldRole = previous.role ?? "";
  const oldDefault = defaultRosterRole(previous.attendeeType);
  if (next.attendeeType !== previous.attendeeType && oldDefault && oldRole === oldDefault) {
    return defaultRosterRole(next.attendeeType);
  }
  return oldRole;
}

/** Class levels belong to youth only (#375): a person carried as anyone else has none. */
export function carriedClassLevel(
  previous: { classLevel: ClubClassLevel | null },
  next: { attendeeType: string; classLevel?: ClubClassLevel | null },
) {
  if (next.attendeeType !== "YOUTH") return null;
  const level = next.classLevel === undefined ? previous.classLevel : next.classLevel;
  // TLT is a flag now (#1851), not a current class.
  return level === "TLT" ? null : level;
}

/** The TLT flag (#1851) is youth only: carried as last year's unless the director chose, and dropped for any other type. */
export function carriedIsTlt(previous: { isTlt: boolean }, next: { attendeeType: string; isTlt?: boolean }) {
  if (next.attendeeType !== "YOUTH") return false;
  return next.isTlt === undefined ? previous.isTlt : next.isTlt;
}

/**
 * Grade, school type and church membership (#1664, #1668) belong to youth only, like the class. A carried youth keeps
 * last year's value unless the director chose another one in the reviewed "Move everyone up one grade" step: nothing
 * moves up on its own. Anyone carried as another type has none.
 */
export function carriedSchoolValue<T>(
  previous: T | null,
  next: { attendeeType: string },
  chosen: T | null | undefined,
): T | null {
  if (next.attendeeType !== "YOUTH") return null;
  return chosen === undefined ? previous : chosen;
}


/**
 * Who the "may have graduated" notice names on the carry-forward review (#1664): youth who were in 12th grade last year
 * and are still in 12th grade in the choices. Someone moved up from 11th to 12th is not flagged.
 */
export function seniorsToReview<T>(
  rows: readonly T[],
  options: { previousGrade: (row: T) => string | null | undefined; choice: (row: T) => { ticked: boolean; attendeeType: string; schoolGrade: string } },
): T[] {
  return rows.filter((row) => {
    const choice = options.choice(row);
    return choice.ticked && choice.attendeeType === "YOUTH" && options.previousGrade(row) === "GRADE_12" && choice.schoolGrade === "GRADE_12";
  });
}

const classLevel = z.enum(["FRIEND", "COMPANION", "EXPLORER", "RANGER", "VOYAGER", "GUIDE", "BASIC_STAFF_TRAINING", "MASTER_GUIDE"]).nullable();

/** One ticked person: omitted fields keep what last year's row had. Unticked people are simply left out. */
export const carryForwardInputSchema = z.object({
  confirm: z.literal(true, "Confirm that you want to start the new year's roster."),
  people: z.array(z.object({
    memberId: z.string().trim().min(1).max(64),
    attendeeType: z.enum(["YOUTH", "STAFF", "ADULT", "UNDERAGE"]),
    role: z.string().trim().max(60).optional(),
    classLevel: classLevel.optional(),
    /** TLT yes/no (#1851); omitted keeps last year's. Dropped for anyone not carried as youth. */
    isTlt: z.boolean().optional(),
    /** The reviewed new grade (#1664); omitted keeps last year's. */
    schoolGrade: z.enum(["GRADE_K", "GRADE_1", "GRADE_2", "GRADE_3", "GRADE_4", "GRADE_5", "GRADE_6", "GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10", "GRADE_11", "GRADE_12", "NOT_IN_SCHOOL"]).nullable().optional(),
  }).strict()).min(1, "Tick at least one person to carry forward.").max(1000),
}).strict().refine((data) => new Set(data.people.map((person) => person.memberId)).size === data.people.length, {
  message: "A person is listed twice.",
  path: ["people"],
});

export type CarryForwardInput = z.infer<typeof carryForwardInputSchema>;
