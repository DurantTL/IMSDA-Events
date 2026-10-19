import { z } from "zod";
import { normalizeOrganizationName } from "@/modules/organizations/domain";
import { clubYearChoices, clubYearFor, rosterSectionOf, type ClubClassLevel } from "@/modules/club-rosters/domain";

export { clubYearChoices };

/**
 * Club import (#376) from the old website's Fluent Forms export of form 89,
 * "Pathfinder Yearly Club Registration". Pure: turns an export into editable
 * drafts, one per entry. Only what a club needs is kept: names, roles, ages,
 * and class levels for the roster, and the leader and co-leader's name and
 * email for invites. Addresses, phone numbers, and the child-protection
 * answers are never read (ADR 0005 keeps Sterling Volunteers data off rosters).
 */

export const CLUB_IMPORT_FORM_ID = "89";
export const MAX_IMPORT_BYTES = 5_000_000;

export type ImportPerson = {
  key: string;
  include: boolean;
  firstName: string;
  lastName: string;
  attendeeType: "STAFF" | "YOUTH";
  role: string;
  classLevel: ClubClassLevel | null;
  /** What the form said, when it isn't a known class level. */
  classText: string;
  reportedAge: number | null;
  /**
   * Staff pressed "Keep both" on someone who shares a name and roster section
   * with an earlier person in this registration (#541): import them anyway.
   */
  keepBoth: boolean;
};

export type ImportInvite = {
  key: string;
  include: boolean;
  role: "DIRECTOR" | "DEPUTY";
  name: string;
  email: string;
};

/** Which file a draft came from: the old form 89 export, or the club-list JSON (#1038). */
export type ClubImportKind = "REGISTRATION" | "CLUB_LIST";

export type ClubImportDraft = {
  /** A club-list draft has no people and no invites; confirm creates only the club (#1038). */
  kind: ClubImportKind;
  /** Club-list only: the town or church name the church is suggested from. Empty for form 89. */
  churchHint: string;
  /** Club-list only: IA or MO narrows the church suggestion. */
  state: string | null;
  /** Club-list only: carried to a new club. */
  isActive: boolean;
  /** Club-list only: free text shown on the row for the reviewer. */
  checkNote: string;
  /** Club-list only: an organization id from the file, used as the suggested church when it is an active sponsor. */
  sponsoringChurchId: string | null;
  /** Club-list only: the club's older names, also used to find it in the directory. */
  namesOnSheet: string[];
  sourceKey: string;
  entryId: string;
  /** The club year the roster is imported into. Defaults to the current one at import time, not the submission date (#541). */
  clubYear: string;
  /** The club year the entry was submitted in, from `created_at`. Informational only. */
  submittedClubYear: string;
  submittedOn: string;
  churchName: string;
  clubName: string;
  invites: ImportInvite[];
  people: ImportPerson[];
  approxPathfinders: string;
};

const entrySchema = z.object({
  id: z.union([z.number(), z.string()]),
  form_id: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
  response: z.record(z.string(), z.unknown()),
});

const text = (value: unknown, max = 120) => (typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max) : "");

function rows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => text(cell, 200)));
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const NAME_PARTICLES = new Set(["de", "van", "von", "da", "del"]);

const AMBIGUOUS_SUFFIXES = new Set(["ii", "iv"]);
const isSuffix = (word: string) => NAME_SUFFIXES.has(word.toLowerCase().replace(/\./g, ""));
const isParticle = (word: string) => NAME_PARTICLES.has(word.toLowerCase());

/**
 * "Jane Q Example" → first "Jane Q", last "Example". One word stays a first
 * name. A suffix (Jr., Sr., II, III, IV) stays with the last name: "Chris
 * Faux Jr." → last "Faux Jr." (#541). A particle (de, de la, van, von, da,
 * del) joins the last name when another word follows it: "Ana de la Cruz" →
 * last "de la Cruz". The first name always keeps at least one word, so "Van
 * Example" stays first "Van". The preview shows the split and staff can edit it.
 */
export function splitName(fullName: string) {
  // "Chris Faux, Jr." → "Chris Faux Jr."
  const words = text(fullName, 160).replace(/,\s*(?=(?:jr|sr|ii|iii|iv)\.?(?:\s|$))/gi, " ").split(" ").filter(Boolean);
  if (words.length <= 1) return { firstName: words[0] ?? "", lastName: "" };
  let end = words.length;
  // A trailing suffix belongs to the word before it; with nothing before it but a first name, there is no last name to attach to.
  // "II" and "IV" are also surnames: "Kim Iv" keeps last name "Iv" rather than losing it.
  while (end > 1 && isSuffix(words[end - 1]) && !(end === 2 && AMBIGUOUS_SUFFIXES.has(words[end - 1].toLowerCase().replace(/\./g, "")))) end -= 1;
  if (end <= 1) return { firstName: words.join(" ").slice(0, 80), lastName: "" };
  let start = end - 1;
  // A capitalised "Van" in the middle of exactly three words is a middle name ("Tran Van Minh"), not a particle.
  const vietnameseVan = end === 3 && words[1] === "Van";
  if (start > 1 && isParticle(words[start - 1]) && !vietnameseVan) start -= 1;
  // "de la" is the one two-word particle.
  else if (start > 2 && words[start - 1].toLowerCase() === "la" && words[start - 2].toLowerCase() === "de") start -= 2;
  return { firstName: words.slice(0, start).join(" ").slice(0, 80), lastName: words.slice(start).join(" ").slice(0, 80) };
}

const classAliases: Record<string, ClubClassLevel> = {
  friend: "FRIEND",
  companion: "COMPANION",
  explorer: "EXPLORER",
  ranger: "RANGER",
  voyager: "VOYAGER",
  guide: "GUIDE",
  tlt: "TLT",
  teenleadershiptraining: "TLT",
  masterguide: "MASTER_GUIDE",
  mg: "MASTER_GUIDE",
};

export function classLevelFrom(value: string): ClubClassLevel | null {
  return classAliases[value.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

export function ageFrom(value: string) {
  const match = /^\s*(\d{1,2})\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(value: unknown) {
  const email = text(value, 254).toLowerCase();
  return emailPattern.test(email) ? email : "";
}

/** "Albany SDA Church" → "Albany". Used to match churches and name the club. */
export function churchStem(name: string) {
  return text(name, 160)
    .toLowerCase()
    .replace(/seventh[\s-]*day\s+adventist/g, " ")
    .replace(/\b(sda|church|company|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function defaultClubName(churchName: string) {
  const stem = text(churchName, 160)
    .replace(/seventh[\s-]*day\s+adventist/gi, " ")
    .replace(/\b(SDA|Church)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem ? `${stem} Pathfinders` : "";
}

function person(key: string, name: string, fields: Partial<ImportPerson>): ImportPerson {
  const { firstName, lastName } = splitName(name);
  return {
    key,
    include: Boolean(firstName),
    firstName,
    lastName,
    attendeeType: "YOUTH",
    role: "",
    classLevel: null,
    classText: "",
    reportedAge: null,
    keepBoth: false,
    ...fields,
  };
}

function draftFrom(entry: z.infer<typeof entrySchema>, now: Date): ClubImportDraft {
  const response = entry.response;
  const churches = Array.isArray(response.multi_select) ? response.multi_select.map((value) => text(value, 160)) : [text(response.multi_select, 160)];
  const churchName = churches.find(Boolean) ?? "";
  const submitted = entry.created_at ? new Date(entry.created_at.replace(" ", "T") + "Z") : new Date();
  const submittedOn = Number.isNaN(submitted.getTime()) ? "" : submitted.toISOString().slice(0, 10);
  // A registration for the coming year is often sent in August, before the
  // club year turns over in September. The roster it belongs to is the one
  // being worked on now, so the default is the current club year and the
  // submission's own year is only shown as a note (#541).
  const submittedClubYear = clubYearFor(Number.isNaN(submitted.getTime()) ? now : submitted);
  const clubYear = clubYearFor(now);
  const entryId = String(entry.id);

  const invites: ImportInvite[] = [];
  const people: ImportPerson[] = [];
  for (const [prefix, role, label] of [["leader", "DIRECTOR", "Director"], ["co_leader", "DEPUTY", "Deputy director"]] as const) {
    const name = text(response[`${prefix}_name`], 160);
    const email = cleanEmail(response[`${prefix}_email`]);
    if (!name && !email) continue;
    invites.push({ key: `${prefix}-invite`, include: Boolean(email), role, name, email });
    if (name) people.push(person(prefix, name, { attendeeType: "STAFF", role: label }));
  }
  // Other staff: [name, address, cell, email, child protection]. Only the name is kept.
  rows(response.other_assistants).forEach((row, index) => {
    if (row[0]) people.push(person(`staff-${index}`, row[0], { attendeeType: "STAFF", role: "Staff" }));
  });
  // Pathfinders: [name, age, class].
  rows(response.repeater_container).forEach((row, index) => {
    if (!row[0]) return;
    const classText = row[2] ?? "";
    people.push(person(`pathfinder-${index}`, row[0], {
      attendeeType: "YOUTH",
      role: "Pathfinder",
      reportedAge: ageFrom(row[1] ?? ""),
      classLevel: classLevelFrom(classText),
      classText: classLevelFrom(classText) ? "" : classText.slice(0, 40),
    }));
  });

  return {
    kind: "REGISTRATION",
    churchHint: "",
    state: null,
    isActive: true,
    checkNote: "",
    sponsoringChurchId: null,
    namesOnSheet: [],
    sourceKey: `form-${CLUB_IMPORT_FORM_ID}:${entryId}`,
    entryId,
    clubYear,
    submittedClubYear,
    submittedOn,
    churchName,
    clubName: defaultClubName(churchName),
    invites,
    people,
    approxPathfinders: text(response.approx_pathfinders, 10),
  };
}

export class ClubImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClubImportParseError";
  }
}

/** The export's entries as drafts. Trashed entries and other forms are skipped. */
export function parseClubRegistrationExport(input: unknown, now = new Date()) {
  if (!Array.isArray(input)) {
    throw new ClubImportParseError("That file isn't a Fluent Forms entries export. Export the form's entries as JSON and try again.");
  }
  const drafts: ClubImportDraft[] = [];
  let skipped = 0;
  for (const raw of input) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const entry = parsed.data;
    if (entry.form_id !== undefined && String(entry.form_id) !== CLUB_IMPORT_FORM_ID) {
      skipped += 1;
      continue;
    }
    if (entry.status === "trashed") {
      skipped += 1;
      continue;
    }
    drafts.push(draftFrom(entry, now));
  }
  if (drafts.length === 0) {
    throw new ClubImportParseError("No club registrations were found in that file. Check that it is the entries export of form 89.");
  }
  return { drafts, skipped };
}

export const MAX_CLUB_LIST_BYTES = 1_000_000;
export const MAX_CLUB_LIST_CLUBS = 500;
export const CLUB_LIST_STATES = ["IA", "MO"] as const;

const clubListItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.string().optional(),
  isActive: z.boolean().default(true),
  sponsoringChurch: z.string().trim().max(40).nullish(),
  churchSearchHint: z.string().nullish(),
  state: z.enum(CLUB_LIST_STATES).nullish(),
  namesOnSheet: z.record(z.string(), z.unknown()).nullish(),
  checkNote: z.string().nullish(),
});

/** True for the club-list JSON: an object with a top-level `clubs` array (#1038). */
export function isClubListExport(input: unknown): input is { clubs: unknown[] } {
  return typeof input === "object" && input !== null && !Array.isArray(input) && Array.isArray((input as { clubs?: unknown }).clubs);
}

/**
 * The club-list JSON as drafts (#1038): one per club, no people and no
 * invites. Unknown fields are ignored. Rows whose `type` is something other
 * than CLUB are skipped. A row that cannot be read stops the whole file with
 * its position, because a half-read list would look complete.
 */
export function parseClubListExport(input: unknown, now = new Date()) {
  if (!isClubListExport(input)) throw new ClubImportParseError("That file isn't a club list. It needs a top-level \"clubs\" array.");
  if (input.clubs.length > MAX_CLUB_LIST_CLUBS) {
    throw new ClubImportParseError(`That list has ${input.clubs.length} clubs. Import at most ${MAX_CLUB_LIST_CLUBS} at a time.`);
  }
  const clubYear = clubYearFor(now);
  const drafts: ClubImportDraft[] = [];
  let skipped = 0;
  input.clubs.forEach((raw, index) => {
    const parsed = clubListItemSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ClubImportParseError(`Club ${index + 1} in the list can't be read: it needs a name of 2 to 120 characters, and state must be IA, MO or empty.`);
    }
    const club = parsed.data;
    if (club.type !== undefined && club.type.toUpperCase() !== "CLUB") {
      skipped += 1;
      return;
    }
    const namesOnSheet = [...new Set(Object.values(club.namesOnSheet ?? {}).map((value) => text(value, 120)).filter(Boolean))].slice(0, 20);
    drafts.push({
      kind: "CLUB_LIST",
      sourceKey: `club-list:${index + 1}`,
      entryId: String(index + 1),
      clubYear,
      submittedClubYear: clubYear,
      submittedOn: "",
      churchName: "",
      churchHint: text(club.churchSearchHint, 120),
      state: club.state ?? null,
      isActive: club.isActive,
      checkNote: text(club.checkNote, 500),
      sponsoringChurchId: club.sponsoringChurch ? club.sponsoringChurch : null,
      namesOnSheet,
      clubName: text(club.name, 120),
      invites: [],
      people: [],
      approxPathfinders: "",
    });
  });
  if (drafts.length === 0) throw new ClubImportParseError("No clubs were found in that list.");
  return { drafts, skipped };
}

/** Either supported file: the club-list JSON or the form 89 export. */
export function parseClubImportFile(input: unknown, now = new Date()) {
  return isClubListExport(input) ? parseClubListExport(input, now) : parseClubRegistrationExport(input, now);
}

/**
 * The names a club-list row is matched on in the directory: its own and its
 * older names, normalized and de-duplicated. The one place to swap in the
 * near-duplicate check from #1031 (`modules/organizations/similar-clubs.ts`)
 * once it merges; until then the match is exact.
 */
export function clubMatchNames(clubName: string, namesOnSheet: string[]) {
  return [...new Set([clubName, ...namesOnSheet].map(normalizeOrganizationName).filter(Boolean))];
}

const STATE_NAMES: Record<string, string> = { iowa: "IA", missouri: "MO" };

/**
 * "IA", "ia", "Iowa" or "Missouri." to IA or MO; null for anything else.
 * `Organization.state` is the eAdventist export's raw StreetState text (up to
 * 40 characters), so a church may hold a code or the full name.
 */
export function stateCode(value: string | null | undefined) {
  const folded = (value ?? "").normalize("NFKC").trim().replace(/[.\s]+$/g, "").toLowerCase();
  if (!folded) return null;
  if (folded === "ia" || folded === "mo") return folded.toUpperCase();
  return STATE_NAMES[folded] ?? null;
}

export type ChurchSuggestionInput = { id: string; name: string; city?: string | null; state?: string | null };
export type ChurchSuggestion = {
  /** Preselected when there is exactly one best match (or the file named a sponsor). */
  churchId: string | null;
  /** Every church that matched, for "pick one". */
  candidateIds: string[];
  status: "GIVEN" | "ONE" | "SEVERAL" | "NONE";
};

/**
 * Suggests a church for a club-list row (#1038) from its hint (a town or
 * church name) with `churchStem`, narrowed by state when given. Tiers: the
 * church's stem equals the hint, the town equals the hint, the stem contains
 * the hint as whole words. The best tier with matches wins; one match is
 * preselected, several say "pick one", none says "no match".
 */
export function suggestChurches(hint: string, state: string | null, churches: ChurchSuggestionInput[], givenId: string | null = null): ChurchSuggestion {
  if (givenId && churches.some((church) => church.id === givenId)) return { churchId: givenId, candidateIds: [givenId], status: "GIVEN" };
  const wanted = churchStem(hint);
  if (!wanted) return { churchId: null, candidateIds: [], status: "NONE" };
  // A church with no state, or one that is neither Iowa nor Missouri, is kept: its record may simply be incomplete.
  const wantedState = stateCode(state);
  const inState = churches.filter((church) => {
    const code = stateCode(church.state);
    return !wantedState || !code || code === wantedState;
  });
  const town = (church: ChurchSuggestionInput) => churchStem(church.city ?? "");
  const tiers: ChurchSuggestionInput[][] = [
    inState.filter((church) => churchStem(church.name) === wanted),
    inState.filter((church) => town(church) === wanted),
    inState.filter((church) => ` ${churchStem(church.name)} `.includes(` ${wanted} `)),
  ];
  const best = tiers.find((tier) => tier.length > 0) ?? [];
  const candidateIds = [...new Set(tiers.flat().map((church) => church.id))];
  if (best.length === 1) return { churchId: best[0]!.id, candidateIds, status: "ONE" };
  if (best.length > 1) return { churchId: null, candidateIds, status: "SEVERAL" };
  return { churchId: null, candidateIds: [], status: "NONE" };
}

/** The ExternalIdentity scope: one import per club per club year. */
export function importScope(clubYear: string) {
  return `form-${CLUB_IMPORT_FORM_ID}:${clubYear}`;
}

/** "form-89:2025-26" → "2025-26"; null for any other scope. */
export function scopeClubYear(providerScope: string) {
  const prefix = `form-${CLUB_IMPORT_FORM_ID}:`;
  const year = providerScope.startsWith(prefix) ? providerScope.slice(prefix.length) : "";
  return /^\d{4}-\d{2}$/.test(year) ? year : null;
}

/** Shown when the submission date falls in a different club year than the one chosen. */
export function submissionYearNote(draft: Pick<ClubImportDraft, "clubYear" | "submittedClubYear" | "submittedOn">) {
  if (!draft.submittedOn || draft.submittedClubYear === draft.clubYear) return "";
  return `Submitted ${draft.submittedOn}, which falls in the ${draft.submittedClubYear} club year. Importing into ${draft.clubYear}.`;
}

/** Why a person was not added; carried to the result screen so no skip is silent. */
export type ImportSkipReason = "ALREADY_ON_ROSTER" | "DUPLICATE_IN_REGISTRATION";

export function skipReasonLabel(reason: ImportSkipReason, clubYear: string) {
  return reason === "ALREADY_ON_ROSTER"
    ? `already on the roster for ${clubYear}`
    : "listed twice in this registration with the same name in the same section (if they are different people, add the second one on the roster)";
}

function nameKey(firstName: string, lastName: string) {
  // "Faux Jr." and "Faux Jr" (and "Faux, Jr.") are the same name.
  return `${firstName} ${lastName}`.trim().toLocaleLowerCase("en-US")
    .replace(/,/g, " ")
    .replace(/\b(jr|sr)\./g, "$1")
    .replace(/\s+/g, " ");
}

/**
 * Two people count as the same only when the full name AND the roster
 * section (`rosterSectionOf`) match: a parent on staff and a child in the
 * club who share a name are different people (#541).
 */
export function importPersonKey(person: { attendeeType: "STAFF" | "YOUTH" | "ADULT" | "UNDERAGE"; firstName: string; lastName: string }) {
  return `${rosterSectionOf(person.attendeeType)}|${nameKey(person.firstName, person.lastName)}`;
}

/**
 * The people in one registration that repeat an earlier included person's
 * name and section (#541), by `key`. Not added unless staff press "Keep
 * both": two different youths can share a name, and a copy-paste repeat
 * looks the same.
 */
export function inFileDuplicateKeys(people: Array<Pick<ImportPerson, "key" | "include" | "attendeeType" | "firstName" | "lastName">>) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const person of people) {
    if (!person.include || !person.firstName.trim()) continue;
    const key = importPersonKey(person);
    if (seen.has(key)) duplicates.add(person.key);
    else seen.add(key);
  }
  return duplicates;
}

/** An earlier import of this entry, by club year, as the preview knows it. */
export type ImportedYears = Record<string, { id: string; name: string }>;

export const MOVE_IMPORT_ACTION = "Move import to another year";

/**
 * What the preview says about earlier imports of this entry (#541).
 * `blocking` when it was imported for the chosen year. Otherwise a hint when
 * it was imported for another year only: importing again would create a
 * second copy of everyone, so the Move action is suggested instead.
 */
export function earlierImportNotice(importedYears: ImportedYears, clubYear: string) {
  const here = importedYears[clubYear];
  if (here) {
    return { blocking: true, clubId: here.id, message: `Already imported for ${clubYear}. To fix the year, use ${MOVE_IMPORT_ACTION}.` };
  }
  const [otherYear, other] = Object.entries(importedYears)[0] ?? [];
  if (!otherYear || !other) return null;
  return {
    blocking: false,
    clubId: other.id,
    message: `Already imported for ${otherYear}. Importing it again for ${clubYear} would add everyone a second time. To fix the year, use ${MOVE_IMPORT_ACTION} instead.`,
  };
}
