import { z } from "zod";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { TEAM_LEVELS, teamLabel, teamLevelLabels, type TeamLevel, type TeamLevelInfo } from "@/modules/club-teams/domain";

/**
 * A team's result at each level of a multi-level event (#809, #945): a placement as a number, whether the team advances
 * to the next level, and a note. Pure, so the staff page, the director's read-only view, the CSVs and the tests agree.
 *
 * One event runs Area, Conference and Union. A team registers once, for its Area; 1st and 2nd place at a level
 * advance it to the next, unless staff decide otherwise, and a team that does not advance never appears at the next level.
 */

/** Places that advance to the next level: 1st and 2nd. A tie shares its number, so two 2nds both advance. */
export const ADVANCING_PLACES = 2;

export const PLACEMENT_RANK_MAX = 999;

export const teamResultInputSchema = z.object({
  level: z.enum(TEAM_LEVELS),
  /** 1 is first. Empty (null) when no place has been entered yet. */
  placementRank: z.number()
    .int("Enter the place as a whole number, like 1 or 2.")
    .min(1, "The place starts at 1.")
    .max(PLACEMENT_RANK_MAX, `Keep the place to ${PLACEMENT_RANK_MAX} or lower.`)
    .nullable()
    .default(null),
  /** Staff's decision: true advances the team, false keeps it from advancing, null follows the placement rule. */
  advanceOverride: z.boolean().nullable().default(null),
  notes: z.string().trim().max(2000, "Keep the notes to 2,000 characters or fewer.").default(""),
}).strict();

export type TeamResultInput = z.infer<typeof teamResultInputSchema>;

export type TeamResultView = {
  level: TeamLevel;
  /** Free text from before placement was a number. Read only; empty on anything staff entered since. */
  placement: string;
  placementRank: number | null;
  advanceOverride: boolean | null;
  /** Whether the team advances to the next level: the rule's answer, or staff's override. */
  qualified: boolean;
  /** An old free-text placement with no number yet: staff re-enter it. */
  needsReentry: boolean;
  notes: string;
  updatedAt: string;
};

/** An old free-text placement that staff have not yet re-entered as a number. */
export function placementNeedsReentry(result: { placement: string; placementRank: number | null }) {
  return result.placementRank === null && result.placement.trim() !== "";
}

/** A result with nothing in it: no place, no override, no note. Saving one clears the level instead of storing it. */
export function resultIsBlank(input: Pick<TeamResultInput, "placementRank" | "advanceOverride" | "notes">) {
  return input.placementRank === null && input.advanceOverride === null && input.notes === "";
}

/** 1 as "1st", 2 as "2nd", 11 as "11th". */
export function ordinal(value: number) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

/** The placement as it reads: "2nd", else the old free text, else blank. */
export function placementLabel(result: Pick<TeamResultView, "placement" | "placementRank"> | null) {
  if (!result) return "";
  return typeof result.placementRank === "number" ? ordinal(result.placementRank) : result.placement;
}

/** The level a team advances to from this one; null after the last. */
export function nextLevel(level: TeamLevel): TeamLevel | null {
  const index = TEAM_LEVELS.indexOf(level);
  return TEAM_LEVELS[index + 1] ?? null;
}

/** The rule alone: a team advances when it placed 1st or 2nd. A tie shares its number. */
export function advancesByPlacement(placementRank: number | null) {
  return placementRank !== null && placementRank <= ADVANCING_PLACES;
}

/**
 * Whether a team advances from a level. Staff's override wins, either way, and is kept across recomputes. Without one the
 * placement rule decides. A result with an old free-text placement and no number follows what was stored before (it
 * is staff's earlier decision) until it is re-entered. The last level has no next one, so nothing advances from it.
 */
export function effectiveAdvance(level: TeamLevel, result: { placementRank: number | null; advanceOverride: boolean | null; placement: string; qualified: boolean }) {
  if (nextLevel(level) === null) return false;
  if (result.advanceOverride !== null) return result.advanceOverride;
  if (placementNeedsReentry(result)) return result.qualified;
  return advancesByPlacement(result.placementRank);
}

/** One team in the results report, with a result (or none) for each level. */
export type TeamResultsRow = {
  clubEventRegistrationId: string;
  teamName: string;
  clubName: string;
  church: string | null;
  confirmationCode: string;
  status: string;
  /** The team's Area: the event location it registered for. */
  locationId: string | null;
  locationName: string | null;
  /** Team members of 18 or older still waiting for the Area Coordinator's permission (#809). */
  permissionsPending: number;
  results: Record<TeamLevel, TeamResultView | null>;
};

export const emptyResults = (): Record<TeamLevel, TeamResultView | null> => ({ AREA: null, CONFERENCE: null, UNION: null });

/** "Advancing", "Not advancing", or blank when nothing was entered for the level. */
export function qualifiedLabel(result: TeamResultView | null) {
  if (!result) return "";
  return result.qualified ? "Advancing" : "Not advancing";
}

/**
 * Whether a team takes part at a level. Everyone registered is at the Area level; a team is at Conference only when it
 * advanced from Area, and at Union only when it advanced from Conference, so a team that did not advance is never listed.
 */
export function teamIsAtLevel(row: { results: Record<TeamLevel, { qualified: boolean } | null> }, level: TeamLevel): boolean {
  const index = TEAM_LEVELS.indexOf(level);
  if (index <= 0) return true;
  const previous = TEAM_LEVELS[index - 1]!;
  return teamIsAtLevel(row, previous) && row.results[previous]?.qualified === true;
}

/** The teams at a level, in the order given. */
export function teamsAtLevel<T extends { results: Record<TeamLevel, { qualified: boolean } | null> }>(rows: readonly T[], level: TeamLevel): T[] {
  return rows.filter((row) => teamIsAtLevel(row, level));
}

/** A level from a request's query string; anything else is the Area level, where every team starts. */
export function levelFromParam(value: string | null | undefined): TeamLevel {
  return (TEAM_LEVELS as readonly string[]).includes(value ?? "") ? (value as TeamLevel) : "AREA";
}

/**
 * The results CSV: one row per team. Without a level, every level's place, advancing and notes. With one, only the teams at
 * that level (a Conference list never includes a team that did not advance) and that level's columns.
 */
export function teamResultsCsvRows(rows: readonly TeamResultsRow[], level?: TeamLevel): Array<Array<string | number>> {
  const levels = level ? [level] : TEAM_LEVELS;
  const table: Array<Array<string | number>> = [[
    "Team", "Club", "Church", "Confirmation", "Area", "AC permission pending",
    ...levels.flatMap((each) => [`${teamLevelLabels[each]} place`, `${teamLevelLabels[each]} advancing`, `${teamLevelLabels[each]} notes`]),
  ]];
  for (const row of level ? teamsAtLevel(rows, level) : rows) {
    table.push([
      row.teamName,
      row.clubName,
      row.church ?? "",
      row.confirmationCode,
      row.locationName ?? "",
      row.permissionsPending,
      ...levels.flatMap((each) => {
        const result = row.results[each];
        return [placementLabel(result), result ? (result.qualified ? "Yes" : "No") : "", result?.notes ?? ""];
      }),
    ]);
  }
  return table;
}

/** One team at a level, with the people who come with it: the list staff run the level from. */
export type LevelTeamRow = {
  clubEventRegistrationId: string;
  teamName: string;
  clubName: string;
  church: string | null;
  confirmationCode: string;
  areaName: string | null;
  members: string[];
  alternate: string;
  coaches: string[];
  /** Checked in at this level (the Area level uses the usual attendee check-in instead). */
  checkedInAt: string | null;
  /** A notice about the next level has been queued for this team. */
  noticeQueued: boolean;
};

/** The roster CSV for a level: one row per person, with the team, club, Area and role. Names only, nothing private. */
export function levelRosterCsvRows(rows: readonly LevelTeamRow[]): Array<Array<string | number>> {
  const table: Array<Array<string | number>> = [["Team", "Club", "Church", "Confirmation", "Area", "Role", "Name"]];
  for (const row of rows) {
    const base = [row.teamName, row.clubName, row.church ?? "", row.confirmationCode, row.areaName ?? ""];
    for (const name of row.members) table.push([...base, "Team member", name]);
    if (row.alternate) table.push([...base, "Alternate", row.alternate]);
    for (const name of row.coaches) table.push([...base, "Coach", name]);
  }
  return table;
}

/** Where and when a level is held, from the event's `levelInfo`; null when staff have not entered it. */
export function levelInfoFor(levelInfo: readonly TeamLevelInfo[], level: TeamLevel): TeamLevelInfo | null {
  return levelInfo.find((entry) => entry.level === level) ?? null;
}

/** "December 5, 2027 at Camp Heritage", "December 5, 2027", "Camp Heritage", or blank. */
export function levelWhenWhere(info: Pick<TeamLevelInfo, "date" | "place"> | null) {
  if (!info) return "";
  const date = info.date ? formatCalendarDate(info.date) : "";
  const place = info.place.trim();
  return date && place ? `${date} at ${place}` : date || place;
}

/**
 * The director's notice that a team advanced: the plain text and subject, written from facts. The next level's date and
 * place come from the event's `levelInfo`; when staff have not entered them the notice says they will follow.
 */
export function advancementNotice(input: {
  eventName: string;
  directorName: string;
  clubName: string;
  teamName: string | null;
  fromLevel: TeamLevel;
  toLevel: TeamLevel;
  info: Pick<TeamLevelInfo, "date" | "place"> | null;
  link: string;
}) {
  const label = teamLabel(input.clubName, input.teamName);
  const to = teamLevelLabels[input.toLevel];
  const date = input.info?.date ? formatCalendarDate(input.info.date) : null;
  const place = input.info?.place.trim() || null;
  const lines = [
    `Hello ${input.directorName || "there"},`,
    "",
    `Congratulations! ${label} advanced from the ${teamLevelLabels[input.fromLevel]} level to the ${to} level of ${input.eventName}.`,
    "",
    "You do not need to register again: your team is already on the list.",
    "",
    date ? `${to} date: ${date}` : `${to} date: to be announced`,
    place ? `${to} place: ${place}` : `${to} place: to be announced`,
    "",
    "You can still update your team's members before then, within the same team rules (team size, the alternate, and ages on the age date):",
    input.link,
    "",
    "IMSDA Events",
  ];
  return { subject: `${label} advanced to ${to}`, text: lines.join("\n") };
}

/** The deterministic outbox key: one notice per team and level, so pressing "Send notices" twice never doubles one. */
export function advancementNoticeKey(clubEventRegistrationId: string, toLevel: TeamLevel) {
  return `club-team-advancement-notice:${clubEventRegistrationId}:${toLevel}`;
}

/** The highest level a team has reached: Area until it advances, then Conference, then Union. */
export function currentLevelOf(row: { results: Record<TeamLevel, { qualified: boolean } | null> }): TeamLevel {
  let current: TeamLevel = "AREA";
  for (const level of TEAM_LEVELS) if (teamIsAtLevel(row, level)) current = level;
  return current;
}

/**
 * Whether a director may still change an advanced team's people (#945) after the registration window has closed. Between
 * levels the team can be updated under the same team rules (size, alternate, ages on the age date): from the moment it
 * advances until the level it advanced to is held. That level is held when its date has passed or staff have entered a
 * result for it. A team that has not advanced has no extra window: it follows the registration window as always.
 */
export function betweenLevelsEditOpen(
  row: { results: Record<TeamLevel, { qualified: boolean } | null> },
  levelInfo: readonly TeamLevelInfo[],
  today: string,
): { open: true; level: TeamLevel } | { open: false } {
  const level = currentLevelOf(row);
  if (level === "AREA") return { open: false };
  if (row.results[level] !== null) return { open: false };
  const date = levelInfoFor(levelInfo, level)?.date ?? null;
  if (date !== null && today > date) return { open: false };
  return { open: true, level };
}
