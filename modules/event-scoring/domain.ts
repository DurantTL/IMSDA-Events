import { z } from "zod";

/**
 * Camporee scoring (#1676), pure rules and no database: how a score is typed and shown, how scored events are defined,
 * how entries are ranked (ties share a place), which ribbon each entry earns, and the per-club ribbon list and award
 * counts. The tool is optional: an Area Coordinator, the Clubs Administrator or staff turn it on for a club event.
 * Nothing here changes club points (a separate feature).
 */

export const scoreKinds = ["CLUB", "PATHFINDER"] as const;
export type ScoreKind = (typeof scoreKinds)[number];
export const scoreUnits = ["POINTS", "FEET", "TIME"] as const;
export type ScoreUnit = (typeof scoreUnits)[number];
export const ribbonModes = ["PLACES", "BANDS"] as const;
export type RibbonMode = (typeof ribbonModes)[number];

export const kindLabels: Record<ScoreKind, string> = { CLUB: "A score for each club", PATHFINDER: "A place or score for each Pathfinder" };
export const unitLabels: Record<ScoreUnit, string> = { POINTS: "Points", FEET: "Feet", TIME: "Time (minutes and seconds)" };
export const ribbonModeLabels: Record<RibbonMode, string> = { PLACES: "By place (1st to 3rd)", BANDS: "By score band" };

export type RibbonBand = { label: string; thresholdHundredths: number };

export type ScoredEventDefinition = {
  id: string;
  name: string;
  kind: ScoreKind;
  unit: ScoreUnit;
  higherWins: boolean;
  ribbonMode: RibbonMode;
  ribbonPlaces: number;
  ribbonBands: RibbonBand[];
};

/** The most a score can be: 100,000 points or feet, or 99 minutes. Keeps every value inside a database integer. */
export const maxScoreHundredths = 10_000_000;

export function normalizeScoredEventName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Reads what a person typed as a score, in the unit's own form, into hundredths. Points and feet are a number with up to
 * two decimals. A time is seconds ("45.2"), or minutes and seconds ("1:02.5"). Returns the problem in plain words instead.
 */
export function parseScoreText(unit: ScoreUnit, text: string): { ok: true; hundredths: number } | { ok: false; message: string } {
  const value = text.trim();
  if (value === "") return { ok: false, message: "Enter a score." };
  if (unit === "TIME") {
    const match = /^(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) return { ok: false, message: "Enter a time like 45.2 or 1:02.5 (minutes:seconds)." };
    const minutes = match[1] === undefined ? 0 : Number(match[1]);
    const seconds = Number(match[2]);
    if (match[1] !== undefined && seconds > 59) return { ok: false, message: "Seconds must be 59 or less when you enter minutes." };
    const fraction = match[3] === undefined ? 0 : Number(match[3].padEnd(2, "0"));
    const hundredths = (minutes * 60 + seconds) * 100 + fraction;
    if (hundredths > maxScoreHundredths) return { ok: false, message: "That time is too long." };
    return { ok: true, hundredths };
  }
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return { ok: false, message: unit === "FEET" ? "Enter feet as a number, like 42 or 42.5." : "Enter points as a number, like 85 or 85.5." };
  const hundredths = Number(match[1]) * 100 + (match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0")));
  if (hundredths > maxScoreHundredths) return { ok: false, message: "That score is too high." };
  return { ok: true, hundredths };
}

function trimmedNumber(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/** A stored score as people read it: "85", "42.5 ft", "1:02.5". */
export function formatScore(unit: ScoreUnit, hundredths: number): string {
  if (unit === "TIME") {
    const minutes = Math.trunc(hundredths / 6000);
    const rest = hundredths % 6000;
    const seconds = Math.trunc(rest / 100);
    const fraction = rest % 100;
    const secondsText = `${minutes > 0 ? String(seconds).padStart(2, "0") : String(seconds)}${fraction === 0 ? "" : `.${String(fraction).padStart(2, "0").replace(/0$/, "")}`}`;
    return minutes > 0 ? `${minutes}:${secondsText}` : `${secondsText} sec`;
  }
  return unit === "FEET" ? `${trimmedNumber(hundredths)} ft` : trimmedNumber(hundredths);
}

/** The score as it is typed back into an edit box (no unit word). */
export function scoreInputText(unit: ScoreUnit, hundredths: number): string {
  return unit === "TIME" ? formatScore(unit, hundredths).replace(/ sec$/, "") : trimmedNumber(hundredths);
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function ordinal(place: number): string {
  const lastTwo = place % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[place % 10] ?? "th";
  return `${place}${suffix}`;
}

export function placeLabel(place: number): string {
  return `${ordinal(place)} place`;
}

const bandInputSchema = z.object({
  label: z.string().trim().min(1, "Name each ribbon band.").max(30, "A band name can be at most 30 characters."),
  threshold: z.string().trim().max(12),
}).strict();

/** What staff send to define or change a scored event. Band thresholds are typed in the unit's own form. */
export const scoredEventInputSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1, "Enter the event's name.").max(80, "The name can be at most 80 characters."),
  kind: z.enum(scoreKinds),
  unit: z.enum(scoreUnits),
  higherWins: z.boolean(),
  ribbonMode: z.enum(ribbonModes),
  ribbonPlaces: z.number().int().min(1, "Choose 1 to 3 ribbon places.").max(3, "Choose 1 to 3 ribbon places."),
  ribbonBands: z.array(bandInputSchema).max(6, "Use at most 6 ribbon bands."),
}).strict();

export type ScoredEventInput = z.infer<typeof scoredEventInputSchema>;

/**
 * The input turned into a stored definition, or the problems by field. Bands run from the best band to the lowest and each
 * must be a worse score than the one before it, so a score earns the first band it meets.
 */
export function buildScoredEventDefinition(input: ScoredEventInput): { ok: true; value: Omit<ScoredEventDefinition, "id"> } | { ok: false; problems: Record<string, string> } {
  const problems: Record<string, string> = {};
  const bands: RibbonBand[] = [];
  if (input.ribbonMode === "BANDS") {
    if (input.ribbonBands.length === 0) problems.ribbonBands = "Add at least one ribbon band, or choose ribbons by place.";
    input.ribbonBands.forEach((band, index) => {
      const parsed = parseScoreText(input.unit, band.threshold);
      if (!parsed.ok) {
        problems[`ribbonBands.${index}.threshold`] = parsed.message;
        return;
      }
      const previous = bands[bands.length - 1];
      if (previous && (input.higherWins ? parsed.hundredths >= previous.thresholdHundredths : parsed.hundredths <= previous.thresholdHundredths)) {
        problems[`ribbonBands.${index}.threshold`] = input.higherWins ? "List bands from the highest score to the lowest." : "List bands from the lowest score to the highest.";
        return;
      }
      bands.push({ label: band.label, thresholdHundredths: parsed.hundredths });
    });
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: { name: input.name, kind: input.kind, unit: input.unit, higherWins: input.higherWins, ribbonMode: input.ribbonMode, ribbonPlaces: input.ribbonPlaces, ribbonBands: bands },
  };
}

/** Whether a score meets a band's threshold, in the event's direction. */
function meetsBand(definition: Pick<ScoredEventDefinition, "higherWins">, value: number, band: RibbonBand): boolean {
  return definition.higherWins ? value >= band.thresholdHundredths : value <= band.thresholdHundredths;
}

export type RankedEntry = { subjectId: string; valueHundredths: number; rank: number; tied: boolean };

/**
 * Ranks entries best first. Equal scores share a place and the next place is skipped (1, 1, 3). `tied` marks every entry
 * that shares its place, so a tie is shown and never broken by who was typed first.
 */
export function rankEntries(entries: ReadonlyArray<{ subjectId: string; valueHundredths: number }>, higherWins: boolean): RankedEntry[] {
  const sorted = [...entries].sort((a, b) => (higherWins ? b.valueHundredths - a.valueHundredths : a.valueHundredths - b.valueHundredths) || a.subjectId.localeCompare(b.subjectId));
  const counts = new Map<number, number>();
  for (const entry of sorted) counts.set(entry.valueHundredths, (counts.get(entry.valueHundredths) ?? 0) + 1);
  const firstIndex = new Map<number, number>();
  sorted.forEach((entry, index) => {
    if (!firstIndex.has(entry.valueHundredths)) firstIndex.set(entry.valueHundredths, index);
  });
  return sorted.map((entry) => ({
    subjectId: entry.subjectId,
    valueHundredths: entry.valueHundredths,
    rank: (firstIndex.get(entry.valueHundredths) ?? 0) + 1,
    tied: (counts.get(entry.valueHundredths) ?? 0) > 1,
  }));
}

/** The ribbon an entry earns, or null: a place in the first `ribbonPlaces`, or the first score band it meets. */
export function ribbonFor(definition: Pick<ScoredEventDefinition, "ribbonMode" | "ribbonPlaces" | "ribbonBands" | "higherWins">, entry: { rank: number; valueHundredths: number }): string | null {
  if (definition.ribbonMode === "PLACES") return entry.rank <= definition.ribbonPlaces ? placeLabel(entry.rank) : null;
  return definition.ribbonBands.find((band) => meetsBand(definition, entry.valueHundredths, band))?.label ?? null;
}

/** The ribbon rule in a sentence, for staff and directors. */
export function ribbonRuleSummary(definition: Pick<ScoredEventDefinition, "ribbonMode" | "ribbonPlaces" | "ribbonBands" | "unit" | "higherWins">): string {
  if (definition.ribbonMode === "PLACES") return definition.ribbonPlaces === 1 ? "Ribbon for 1st place" : `Ribbons for 1st to ${ordinal(definition.ribbonPlaces)} place`;
  if (definition.ribbonBands.length === 0) return "Ribbons by score band (no bands yet)";
  return `Ribbons by score: ${definition.ribbonBands.map((band) => `${band.label} at ${formatScore(definition.unit, band.thresholdHundredths)} or ${definition.higherWins ? "more" : "less"}`).join(", ")}`;
}

export type ScoreRecord = { scoredEventId: string; subjectId: string; organizationId: string; valueHundredths: number };

export type ResultSubjects = {
  /** Registered clubs by organization id. `wantsRibbons` is the club's own yes or no from registration. */
  clubs: ReadonlyMap<string, { name: string; wantsRibbons: boolean }>;
  /** Pathfinders by registration attendee id. */
  people: ReadonlyMap<string, { name: string; organizationId: string }>;
};

export type ResultRow = {
  subjectId: string;
  organizationId: string;
  /** The club's name for a club score, the Pathfinder's name for a person's. */
  name: string;
  clubName: string;
  rank: number;
  tied: boolean;
  scoreText: string;
  /** The ribbon this entry earns by the event's rule, whether or not its club asked for ribbons. */
  award: string | null;
  /** Whether the entry's club asked for ribbons on registration. A club that did not gets scores only. */
  ribbonWanted: boolean;
};

export type EventResult = {
  id: string;
  name: string;
  kind: ScoreKind;
  unit: ScoreUnit;
  higherWins: boolean;
  ribbonRule: string;
  rows: ResultRow[];
};

export type RibbonLine = { eventName: string; recipient: string; award: string };

export type ClubAwards = {
  organizationId: string;
  clubName: string;
  wantsRibbons: boolean;
  firsts: number;
  seconds: number;
  thirds: number;
  /** Ribbons earned by score band (any label). */
  bandRibbons: number;
  /** The ribbons to hand this club: empty for a club that did not ask for them. */
  ribbons: RibbonLine[];
};

export type EventScoringResults = {
  events: EventResult[];
  clubs: ClubAwards[];
  /** First places across every event, ties counted for each winner: the trophies to order. */
  trophies: number;
  /** Ribbons to hand out, counted for clubs that asked for them only, by award name. */
  ribbonCounts: Array<{ award: string; count: number }>;
  ribbonsTotal: number;
};

/**
 * Everything a published result page shows, from the scored events, the scores and who is registered. A score whose subject
 * is no longer registered is left out. Trophies count first places for every club; ribbons are listed only for clubs that
 * answered yes, and the others still appear with their scores.
 */
export function buildResults(definitions: readonly ScoredEventDefinition[], scores: readonly ScoreRecord[], subjects: ResultSubjects): EventScoringResults {
  const awardsByClub = new Map<string, ClubAwards>();
  const awardFor = (organizationId: string): ClubAwards | null => {
    const club = subjects.clubs.get(organizationId);
    if (!club) return null;
    const existing = awardsByClub.get(organizationId);
    if (existing) return existing;
    const created: ClubAwards = { organizationId, clubName: club.name, wantsRibbons: club.wantsRibbons, firsts: 0, seconds: 0, thirds: 0, bandRibbons: 0, ribbons: [] };
    awardsByClub.set(organizationId, created);
    return created;
  };
  for (const organizationId of subjects.clubs.keys()) awardFor(organizationId);

  const events: EventResult[] = definitions.map((definition) => {
    const entries = scores
      .filter((score) => score.scoredEventId === definition.id)
      .filter((score) => (definition.kind === "CLUB" ? subjects.clubs.has(score.subjectId) : subjects.people.has(score.subjectId)));
    const ranked = rankEntries(entries.map((entry) => ({ subjectId: entry.subjectId, valueHundredths: entry.valueHundredths })), definition.higherWins);
    const rows: ResultRow[] = ranked.map((entry) => {
      const person = definition.kind === "PATHFINDER" ? subjects.people.get(entry.subjectId) : undefined;
      const organizationId = person ? person.organizationId : entry.subjectId;
      const club = subjects.clubs.get(organizationId);
      const award = ribbonFor(definition, entry);
      const awards = awardFor(organizationId);
      const recipient = person?.name ?? club?.name ?? "";
      if (awards) {
        if (entry.rank === 1) awards.firsts += 1;
        else if (entry.rank === 2) awards.seconds += 1;
        else if (entry.rank === 3) awards.thirds += 1;
        if (award && definition.ribbonMode === "BANDS") awards.bandRibbons += 1;
        if (award && awards.wantsRibbons) awards.ribbons.push({ eventName: definition.name, recipient, award });
      }
      return {
        subjectId: entry.subjectId,
        organizationId,
        name: recipient,
        clubName: club?.name ?? "",
        rank: entry.rank,
        tied: entry.tied,
        scoreText: formatScore(definition.unit, entry.valueHundredths),
        award,
        ribbonWanted: awards?.wantsRibbons ?? false,
      };
    });
    return { id: definition.id, name: definition.name, kind: definition.kind, unit: definition.unit, higherWins: definition.higherWins, ribbonRule: ribbonRuleSummary(definition), rows };
  });

  const clubs = [...awardsByClub.values()].sort((a, b) => a.clubName.localeCompare(b.clubName));
  const counts = new Map<string, number>();
  for (const club of clubs) for (const line of club.ribbons) counts.set(line.award, (counts.get(line.award) ?? 0) + 1);
  return {
    events,
    clubs,
    trophies: clubs.reduce((sum, club) => sum + club.firsts, 0),
    ribbonCounts: [...counts].map(([award, count]) => ({ award, count })).sort((a, b) => a.award.localeCompare(b.award)),
    ribbonsTotal: [...counts.values()].reduce((sum, count) => sum + count, 0),
  };
}

/**
 * One club's own results: only the rows of that club, in each event it has an entry in, with the place it earned among all
 * entries. Another club's names and scores are never in what this returns.
 */
export function resultsForClub(results: EventScoringResults, organizationId: string): { events: EventResult[]; awards: ClubAwards | null } {
  const events = results.events
    .map((event) => ({ ...event, rows: event.rows.filter((row) => row.organizationId === organizationId) }))
    .filter((event) => event.rows.length > 0);
  return { events, awards: results.clubs.find((club) => club.organizationId === organizationId) ?? null };
}

/** What staff or a coordinator can do with the tool. Publishing stays with staff; entering is shared. */
export type ScoringCapabilities = { canSwitch: boolean; canDefine: boolean; canEnter: boolean; canPublish: boolean; canCorrectAfterPublish: boolean };

/** The score entry a person sends: a subject and the score as typed, or null to remove the score. */
export const scoreEntrySchema = z.object({
  scoredEventId: z.string().trim().min(1).max(64),
  subjectId: z.string().trim().min(1).max(64),
  value: z.string().trim().max(12).nullable(),
}).strict();
export type ScoreEntryInput = z.infer<typeof scoreEntrySchema>;

/**
 * One request shape for every action, so a staff route and an Area Coordinator route share a handler. The server decides
 * which actions the caller may take.
 */
export const eventScoringActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("saveScoredEvent"), scoredEvent: scoredEventInputSchema }).strict(),
  z.object({ action: z.literal("deleteScoredEvent"), id: z.string().trim().min(1).max(64) }).strict(),
  z.object({ action: z.literal("saveScore"), entry: scoreEntrySchema }).strict(),
  z.object({ action: z.literal("publish") }).strict(),
  z.object({ action: z.literal("unpublish") }).strict(),
]);
export type EventScoringAction = z.infer<typeof eventScoringActionSchema>;
