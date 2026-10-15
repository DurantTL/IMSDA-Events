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
  return next.classLevel === undefined ? previous.classLevel : next.classLevel;
}

const classLevel = z.enum(["FRIEND", "COMPANION", "EXPLORER", "RANGER", "VOYAGER", "GUIDE", "TLT", "MASTER_GUIDE"]).nullable();

/** One ticked person: omitted fields keep what last year's row had. Unticked people are simply left out. */
export const carryForwardInputSchema = z.object({
  confirm: z.literal(true, "Confirm that you want to start the new year's roster."),
  people: z.array(z.object({
    memberId: z.string().trim().min(1).max(64),
    attendeeType: z.enum(["YOUTH", "STAFF", "ADULT", "UNDERAGE"]),
    role: z.string().trim().max(60).optional(),
    classLevel: classLevel.optional(),
  }).strict()).min(1, "Tick at least one person to carry forward.").max(1000),
}).strict().refine((data) => new Set(data.people.map((person) => person.memberId)).size === data.people.length, {
  message: "A person is listed twice.",
  path: ["people"],
});

export type CarryForwardInput = z.infer<typeof carryForwardInputSchema>;
