import { z } from "zod";

/**
 * The TLT directory's rules (#1686), free of server-only imports so tests and client components can use them.
 * The directory holds four editable things per TLT (year, position type, status, help-area tags) and nothing from
 * form answers. Ages are whole years; a birth date never appears here.
 */

export type TltDirectoryErrorCode = "NOT_A_TLT" | "NO_ACTIVE_GRANT" | "POSITION_NOT_AVAILABLE" | "TAG_NOT_AVAILABLE" | "NAME_TAKEN" | "ENTRY_NOT_FOUND" | "NOT_SUGGESTED" | "STALE_CLUB_YEAR" | "YEAR_CHANGED";

export class TltDirectoryError extends Error {
  constructor(public readonly code: TltDirectoryErrorCode, message: string) {
    super(message);
    this.name = "TltDirectoryError";
  }
}

export const TLT_YEARS = [1, 2, 3, 4] as const;
export type TltYear = (typeof TLT_YEARS)[number];
export const tltYearLabel = (year: number | null) => (year ? `Year ${year}` : "Not set");

export const TLT_STATUSES = ["APPLIED", "APPROVED", "ACTIVE", "FINISHED", "LEFT"] as const;
export type TltStatusValue = (typeof TLT_STATUSES)[number];
/** A TLT with no saved record has no status: "Not set", not a guessed "Applied". */
export const tltStatusLabels: Record<TltStatusValue, string> = {
  APPLIED: "Applied",
  APPROVED: "Approved",
  ACTIVE: "Active",
  FINISHED: "Finished",
  LEFT: "Left",
};
export const tltStatusLabel = (status: TltStatusValue | null) => (status ? tltStatusLabels[status] : "Not set");

/** The NAD TLT operational departments (issue #1686 research). Order is the program's. */
export const SEEDED_POSITION_TYPES = [
  { seedKey: "administrative", name: "Administrative" },
  { seedKey: "ay-classwork-honors", name: "AY Classwork/Honors" },
  { seedKey: "outreach", name: "Outreach" },
  { seedKey: "camping-activities", name: "Camping/Activities" },
  { seedKey: "counseling", name: "Counseling" },
  { seedKey: "finance-clerical", name: "Finance/Clerical" },
] as const;

/** Short help-area names for the TLT Opportunities choices (`tltLeadershipOpportunities` in modules/forms/definition.ts). */
export const SEEDED_HELP_TAGS = [
  { seedKey: "setup", name: "Setup" },
  { seedKey: "photography", name: "Photography" },
  { seedKey: "office", name: "Office" },
  { seedKey: "flag-ceremony", name: "Flag ceremony" },
  { seedKey: "pathfinder-song", name: "Pathfinder Song" },
  { seedKey: "drums", name: "Drums" },
  { seedKey: "taps-reveille", name: "Taps or reveille" },
  { seedKey: "bell", name: "Bell ringing" },
  { seedKey: "mc", name: "MC" },
  { seedKey: "praise-team", name: "Praise team" },
  { seedKey: "scoring", name: "Scoring" },
  { seedKey: "campsite-inspection", name: "Campsite inspection" },
  { seedKey: "uniform-inspection", name: "Uniform inspection" },
  { seedKey: "trash-cleanup", name: "Trash and clean-up" },
  { seedKey: "awards", name: "Awards" },
  { seedKey: "games", name: "Games" },
  { seedKey: "town-crier", name: "Town Crier" },
] as const;

/**
 * The TLT Opportunities choices (`tltLeadershipOpportunities` in modules/forms/definition.ts, field
 * `leadership_opportunities`) mapped onto the seeded help-area tags by `seedKey` (#1686). Several choices can map to one
 * tag. A test keeps this list equal to the form's options, so a new choice can't be left unmapped by accident.
 */
export const TLT_OPPORTUNITY_TAG_KEYS: Record<string, (typeof SEEDED_HELP_TAGS)[number]["seedKey"]> = {
  "Come early to set up campsites, fire rings, decorations, chairs/pavilion and trash barrels": "setup",
  "Take pictures during camporee (bring your own camera)": "photography",
  "Help in the office for 1 hour with registration (Thu 3–6 PM)": "office",
  "Call Pathfinders to attention and give and receive the flag for flag raising/lowering": "flag-ceremony",
  "Lead the Pathfinder Song (English or Spanish)": "pathfinder-song",
  "Play drums and lead the clubs to the flag at flag raising/lowering": "drums",
  "Play taps or reveille at flag raising/lowering": "taps-reveille",
  "Give out prizes after the flag ceremony": "flag-ceremony",
  "Direct clubs where to stand for flag raising/lowering": "flag-ceremony",
  "Ring the bell 10 minutes before each activity": "bell",
  "Read a cool fact about the flag at Saturday flag lowering": "flag-ceremony",
  "Be MC at vespers, Sabbath School, Sabbath afternoon skits and worship": "mc",
  "Be on the praise team": "praise-team",
  "Score events in the office (Friday 4 PM)": "scoring",
  "Be on the campsite inspection team (Friday 5 PM)": "campsite-inspection",
  "Friday night trash removal before sunset": "trash-cleanup",
  "Be on the uniform inspection team Saturday morning": "uniform-inspection",
  "Pass out awards and trophies Saturday night": "awards",
  "Help with games Saturday night": "games",
  "Town Crier": "town-crier",
  "Clean up Sunday morning": "trash-cleanup",
};

/** The TLT Opportunities shirt choices (`tltShirtTypes`, `tltShirtSizes`); only these exact values are ever shown. */
export const TLT_SHIRT_TYPES = ["Polo", "T-Shirt"] as const;
export const TLT_SHIRT_SIZES = ["Adult S", "Adult M", "Adult L", "Adult XL", "Adult 2XL"] as const;

/** One submitted TLT Opportunities answer for one person, as the batched read returns it (newest first). */
export type OpportunityAnswerRow = {
  personId: string;
  /** The registration-level `leadership_opportunities` answer (a list of choices), unchecked. */
  opportunities: unknown;
  /** How many people the registration covers: the choices are registration-level, so only a one-person registration is theirs. */
  attendeeCount: number;
  needShirt: string | null;
  shirtType: string | null;
  shirtSize: string | null;
};

export type TltShirt = { needed: boolean; type: string | null; size: string | null };
export type TltAnswerSummary = { seedKeys: string[]; shirt: TltShirt | null };

/**
 * Per person: the seeded tag keys their TLT Opportunities choices map to (every submission, from a one-person
 * registration only), and the shirt from their latest answer that has one. Everything else in an answer is dropped here:
 * only fixed-list values leave this function. `rows` must be newest first.
 */
export function summarizeOpportunityAnswers(rows: readonly OpportunityAnswerRow[]): Map<string, TltAnswerSummary> {
  const summaries = new Map<string, TltAnswerSummary>();
  for (const row of rows) {
    const summary = summaries.get(row.personId) ?? { seedKeys: [], shirt: null };
    summaries.set(row.personId, summary);
    if (row.attendeeCount === 1 && Array.isArray(row.opportunities)) {
      for (const choice of row.opportunities) {
        const key = typeof choice === "string" && Object.hasOwn(TLT_OPPORTUNITY_TAG_KEYS, choice) ? TLT_OPPORTUNITY_TAG_KEYS[choice] : undefined;
        if (key && !summary.seedKeys.includes(key)) summary.seedKeys.push(key);
      }
    }
    if (!summary.shirt && (row.needShirt === "Yes" || row.needShirt === "No")) {
      const needed = row.needShirt === "Yes";
      summary.shirt = {
        needed,
        type: needed && (TLT_SHIRT_TYPES as readonly string[]).includes(row.shirtType ?? "") ? row.shirtType : null,
        size: needed && (TLT_SHIRT_SIZES as readonly string[]).includes(row.shirtSize ?? "") ? row.shirtSize : null,
      };
    }
  }
  return summaries;
}

/** "Polo, Adult M", "No shirt needed", or "No answer yet". */
export function tltShirtLabel(shirt: TltShirt | null) {
  if (!shirt) return "No answer yet";
  if (!shirt.needed) return "No shirt needed";
  return [shirt.type, shirt.size].filter(Boolean).join(", ") || "Needed";
}

export const LIST_NAME_MAX = 60;

/** A list entry's name: trimmed, single spaces, 1 to 60 characters. */
export const listNameSchema = z.string().trim().min(1, "Enter a name.").max(LIST_NAME_MAX, `Keep the name to ${LIST_NAME_MAX} characters.`)
  .transform((value) => value.replace(/\s+/g, " "));

export const sameListName = (a: string, b: string) => a.trim().toLocaleLowerCase("en-US") === b.trim().toLocaleLowerCase("en-US");

const idSchema = z.string().trim().min(1).max(64);

/** The four fields she may change, for one person. Unknown keys are refused (never a roster field). */
export const profileUpdateSchema = z.object({
  personId: idSchema,
  tltYear: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]),
  /** The year the editor loaded; a different stored year means someone changed it since (409, nothing saved). */
  expectedTltYear: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]),
  positionTypeId: idSchema.nullable(),
  status: z.enum(TLT_STATUSES).nullable(),
  tagIds: z.array(idSchema).max(60).transform((ids) => [...new Set(ids)]),
}).strict();
export type TltProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Accepting one suggested tag: a person and a tag, nothing else. The server re-derives that it really is suggested. */
export const suggestionAcceptSchema = z.object({ personId: idSchema, tagId: idSchema }).strict();
export type TltSuggestionAccept = z.infer<typeof suggestionAcceptSchema>;

export const listActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), list: z.enum(["position", "tag"]), name: listNameSchema }).strict(),
  z.object({ action: z.literal("rename"), list: z.enum(["position", "tag"]), id: idSchema, name: listNameSchema }).strict(),
  z.object({ action: z.literal("retire"), list: z.enum(["position", "tag"]), id: idSchema }).strict(),
  z.object({ action: z.literal("restore"), list: z.enum(["position", "tag"]), id: idSchema }).strict(),
]);
export type TltListAction = z.infer<typeof listActionSchema>;

export type TltDirectoryRow = {
  personId: string;
  rosterMemberId: string;
  name: string;
  clubId: string;
  clubName: string;
  /** The club's sponsoring church (its parent organization), or "" when none is on file. */
  church: string;
  /** Whole years, or null when the roster has no birth date. */
  age: number | null;
  reportedAge: number | null;
  grade: string | null;
  tltYear: number | null;
  /** The club year `tltYear` applies to; null when never recorded (#1686 move-up). */
  tltYearClubYear: string | null;
  positionTypeId: string | null;
  positionName: string | null;
  status: TltStatusValue | null;
  tags: Array<{ id: string; name: string }>;
  /** Tags the TLT's TLT Opportunities choices map to that they don't have yet. Offered, never applied (#1686). */
  suggestedTags: Array<{ id: string; name: string }>;
  /** From their latest TLT Opportunities answer; null when they have none. Read-only. */
  shirt: TltShirt | null;
};

export const TLT_SORTS = ["name", "club", "year"] as const;
export type TltSort = (typeof TLT_SORTS)[number];

export type TltFilters = {
  q: string;
  clubId: string;
  /** "1" to "4", "none" for Not set, or "". */
  year: string;
  position: string;
  status: string;
  tag: string;
  sort: TltSort;
};

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();

/** Query-string filters, every value capped; anything unknown falls back to "no filter". */
export function parseTltFilters(query: Query): TltFilters {
  const sort = one(query.sort);
  const year = one(query.year);
  const status = one(query.status);
  return {
    q: one(query.q).slice(0, 80),
    clubId: one(query.club).slice(0, 64),
    year: year === "none" || (TLT_YEARS as readonly number[]).includes(Number(year)) ? year : "",
    position: one(query.position).slice(0, 64),
    status: status === "none" || (TLT_STATUSES as readonly string[]).includes(status) ? status : "",
    tag: one(query.tag).slice(0, 64),
    sort: (TLT_SORTS as readonly string[]).includes(sort) ? (sort as TltSort) : "name",
  };
}

export function filterTltRows(rows: readonly TltDirectoryRow[], filters: TltFilters): TltDirectoryRow[] {
  const needle = filters.q.toLocaleLowerCase("en-US");
  return rows.filter((row) => {
    if (needle && !row.name.toLocaleLowerCase("en-US").includes(needle)) return false;
    if (filters.clubId && row.clubId !== filters.clubId) return false;
    if (filters.year === "none" ? row.tltYear !== null : filters.year && row.tltYear !== Number(filters.year)) return false;
    if (filters.position === "none" ? row.positionTypeId !== null : filters.position && row.positionTypeId !== filters.position) return false;
    if (filters.status === "none" ? row.status !== null : filters.status && row.status !== filters.status) return false;
    if (filters.tag && !row.tags.some((tag) => tag.id === filters.tag)) return false;
    return true;
  });
}

const byName = (a: TltDirectoryRow, b: TltDirectoryRow) => a.name.localeCompare(b.name, "en-US") || a.personId.localeCompare(b.personId);

/** Name, club (then name), or TLT year (Year 1 first, Not set last, then name). */
export function sortTltRows(rows: readonly TltDirectoryRow[], sort: TltSort): TltDirectoryRow[] {
  const copy = [...rows];
  if (sort === "club") return copy.sort((a, b) => a.clubName.localeCompare(b.clubName, "en-US") || byName(a, b));
  if (sort === "year") return copy.sort((a, b) => (a.tltYear ?? 99) - (b.tltYear ?? 99) || byName(a, b));
  return copy.sort(byName);
}

export function tltAgeLabel(row: Pick<TltDirectoryRow, "age" | "reportedAge">) {
  if (row.age !== null) return `Age ${row.age}`;
  if (row.reportedAge !== null) return `Age ${row.reportedAge} (reported)`;
  return "Age not recorded";
}

export const TLT_EXPORT_HEADERS = ["Name", "Club", "Sponsoring church", "Age", "Grade", "TLT year", "Position type", "Status", "Help-area tags", "TLT shirt", "Shirt type", "Shirt size"] as const;

/** The CSV and print columns: exactly what is on screen. No birth date, contact detail, form answer or school detail. */
export function tltExportTable(rows: readonly TltDirectoryRow[]): { headers: string[]; rows: string[][] } {
  return {
    headers: [...TLT_EXPORT_HEADERS],
    rows: rows.map((row) => [
      row.name,
      row.clubName,
      row.church,
      row.age !== null ? String(row.age) : row.reportedAge !== null ? `${row.reportedAge} (reported)` : "",
      row.grade ?? "",
      tltYearLabel(row.tltYear),
      row.positionName ?? "",
      tltStatusLabel(row.status),
      row.tags.map((tag) => tag.name).join("; "),
      row.shirt ? (row.shirt.needed ? "Yes" : "No") : "",
      row.shirt?.type ?? "",
      row.shirt?.size ?? "",
    ]),
  };
}

export const exportBodySchema = z.object({
  q: z.string().max(80).default(""),
  club: z.string().max(64).default(""),
  year: z.string().max(8).default(""),
  position: z.string().max(64).default(""),
  status: z.string().max(16).default(""),
  tag: z.string().max(64).default(""),
  sort: z.string().max(8).default("name"),
}).strict();

/** Which filter keys were in use, for the audit entry (keys only: a search text can be a child's name). */
export function activeFilterKeys(filters: TltFilters): string[] {
  const keys: string[] = [];
  if (filters.q) keys.push("q");
  if (filters.clubId) keys.push("club");
  if (filters.year) keys.push("year");
  if (filters.position) keys.push("position");
  if (filters.status) keys.push("status");
  if (filters.tag) keys.push("tag");
  return keys;
}

/** The status values that take a TLT out of the yearly move-up: they are done with the program. */
const MOVE_UP_EXCLUDED_STATUSES: ReadonlyArray<TltStatusValue> = ["FINISHED", "LEFT"];
export const TLT_MOVE_UP_EXCLUDED_STATUSES = MOVE_UP_EXCLUDED_STATUSES;

export type TltMoveUpFacts = { tltYear: number | null; tltYearClubYear: string | null; status: TltStatusValue | null };

/**
 * Whether a TLT is offered a move up one year at this club year's rollover (#1686): Year 1 to 3, not finished or left,
 * and the year was not already set for this club year (a missing club year counts as an earlier one). Year 4 is the
 * last level and never moves. Club years are "2026-27" strings, which sort in time order.
 */
export function isMoveUpEligible(facts: TltMoveUpFacts, clubYear: string) {
  if (facts.tltYear === null || facts.tltYear < 1 || facts.tltYear > 3) return false;
  if (facts.status && MOVE_UP_EXCLUDED_STATUSES.includes(facts.status)) return false;
  return facts.tltYearClubYear === null || facts.tltYearClubYear < clubYear;
}

export type TltMoveUpRow = {
  personId: string;
  name: string;
  clubName: string;
  tltYear: number | null;
  tltYearClubYear: string | null;
  status: TltStatusValue | null;
};

export type TltMoveUpPlan = {
  clubYear: string;
  /** Offered a move: Year N to Year N+1, in name order. */
  proposed: Array<{ personId: string; name: string; clubName: string; fromYear: number; toYear: number }>;
  /** Year 4: the last level, shown but never moved. */
  lastLevel: Array<{ personId: string; name: string; clubName: string }>;
  /** No year saved yet: shown, never moved. */
  notSet: Array<{ personId: string; name: string; clubName: string }>;
  /** Year 1 to 3 already set for this club year. */
  alreadyThisYear: number;
};

/** The move-up review for the directory's TLTs: finished or left TLTs are left out of every group. */
export function planTltMoveUp(rows: readonly TltMoveUpRow[], clubYear: string): TltMoveUpPlan {
  const byName = (a: { name: string; personId: string }, b: { name: string; personId: string }) => a.name.localeCompare(b.name, "en-US") || a.personId.localeCompare(b.personId);
  const plan: TltMoveUpPlan = { clubYear, proposed: [], lastLevel: [], notSet: [], alreadyThisYear: 0 };
  for (const row of rows) {
    if (row.status && MOVE_UP_EXCLUDED_STATUSES.includes(row.status)) continue;
    const who = { personId: row.personId, name: row.name, clubName: row.clubName };
    if (row.tltYear === null) plan.notSet.push(who);
    else if (row.tltYear >= 4) plan.lastLevel.push(who);
    else if (isMoveUpEligible(row, clubYear)) plan.proposed.push({ ...who, fromYear: row.tltYear, toYear: row.tltYear + 1 });
    else if (row.tltYearClubYear === clubYear) plan.alreadyThisYear += 1;
  }
  plan.proposed.sort(byName);
  plan.lastLevel.sort(byName);
  plan.notSet.sort(byName);
  return plan;
}

/**
 * The move-up request: the club year the page showed, the people she left ticked (`moveIds`) and the proposed people she
 * unticked (`keepIds`, held at their current year for this club year). Nothing else is accepted.
 */
const idList = z.array(idSchema).max(500).default([]).transform((ids) => [...new Set(ids)]);
export const moveUpSchema = z.object({
  clubYear: z.string().trim().regex(/^\d{4}-\d{2}$/, "Reload the page and try again."),
  moveIds: idList,
  keepIds: idList,
}).strict().refine((body) => body.moveIds.length + body.keepIds.length > 0, { message: "Choose at least one TLT." })
  .refine((body) => !body.keepIds.some((id) => body.moveIds.includes(id)), { message: "Reload the page and try again." });
export type TltMoveUpRequest = z.infer<typeof moveUpSchema>;

/** The sentence announced after a move-up: "Moved 5 TLTs up a year. Kept 1 at their current year. 1 was skipped because it had already changed." */
export function moveUpResultMessage(moved: number, skipped: number, kept = 0) {
  const parts: string[] = [];
  if (moved > 0 || kept === 0) parts.push(`Moved ${moved} ${moved === 1 ? "TLT" : "TLTs"} up a year.`);
  if (kept > 0) parts.push(`Kept ${kept} ${kept === 1 ? "TLT" : "TLTs"} at their current year.`);
  if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? "was" : "were"} skipped because ${skipped === 1 ? "it" : "they"} had already changed.`);
  return parts.join(" ");
}
