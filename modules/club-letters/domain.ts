/**
 * Fill-in club letters and certificates (#1708), pure. An optional club feature: a club's director or deputy writes a
 * letter or certificate template whose placeholders (a member's name, the club, the year, today's date) are filled in
 * from the roster, then prints it or saves it as a PDF from the browser. Nothing is emailed or sent from here.
 *
 * The body is plain text, never HTML: it is shown with React's escaping and `white-space: pre-wrap`. Only the
 * placeholders listed here exist; no birth date, contact, health or any other roster field is ever offered.
 */

import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const CLUB_LETTERS_FEATURE_KEY = "fill-in-letters";

export const CLUB_LETTER_KINDS = ["LETTER", "CERTIFICATE"] as const;
export type ClubLetterKindValue = (typeof CLUB_LETTER_KINDS)[number];

export const clubLetterKindLabels: Record<ClubLetterKindValue, string> = {
  LETTER: "Letter",
  CERTIFICATE: "Certificate",
};

export const LETTER_TITLE_MAX = 120;
export const LETTER_BODY_MAX = 10_000;
export const LETTERS_PER_CLUB_MAX = 50;
/** The most people one print view fills in. */
export const PRINT_PEOPLE_MAX = 200;

export const LETTER_PLACEHOLDERS = [
  { key: "first_name", label: "The member's first name" },
  { key: "last_name", label: "The member's last name" },
  { key: "full_name", label: "The member's first and last name" },
  { key: "club_name", label: "Your club's name" },
  { key: "club_year", label: "The club year, such as 2026–27" },
  { key: "date", label: "The date printed, such as November 12, 2026" },
] as const;

export type LetterPlaceholderKey = (typeof LETTER_PLACEHOLDERS)[number]["key"];
const PLACEHOLDER_KEYS: readonly string[] = LETTER_PLACEHOLDERS.map((item) => item.key);

/** Everything between braces, so a misspelled placeholder is found as well as a good one. */
const BRACED = /\{([^{}\n]*)\}/g;

/** The distinct `{names}` in a body that are not one of the placeholders above, in the order they first appear. */
export function unknownPlaceholders(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(BRACED)) {
    const name = match[1]!;
    if (!PLACEHOLDER_KEYS.includes(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

/** A save problem for a body that holds a placeholder that does not exist, naming it; null when the body is fine. */
export function placeholderProblem(body: string): string | null {
  const unknown = unknownPlaceholders(body);
  if (unknown.length === 0) return null;
  const names = unknown.map((name) => `{${name}}`).join(", ");
  return unknown.length === 1
    ? `${names} is not a placeholder. Use only the ones listed under "Placeholders".`
    : `${names} are not placeholders. Use only the ones listed under "Placeholders".`;
}

/** The date as a long US date, such as "November 12, 2026", in the conference's time zone. */
export function formatLetterDate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "America/Chicago", dateStyle: "long" });
}

export type LetterFill = { firstName: string; lastName: string; clubName: string; clubYear: string; date: Date };

/**
 * The body with every placeholder replaced for one person. Done in a single pass, so a name that happens to contain
 * braces is printed as typed and never filled in again. Anything between braces that is not a placeholder is left as is
 * (a save refuses those, so this only matters for older text).
 */
export function fillInLetter(body: string, fill: LetterFill): string {
  const first = fill.firstName.trim();
  const last = fill.lastName.trim();
  const values: Record<LetterPlaceholderKey, string> = {
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(" "),
    club_name: fill.clubName,
    club_year: fill.clubYear.replace("-", "–"),
    date: formatLetterDate(fill.date),
  };
  return body.replace(BRACED, (whole, name: string) => (PLACEHOLDER_KEYS.includes(name) ? values[name as LetterPlaceholderKey] : whole));
}

/** Whether a club may add one more template. */
export function canAddLetter(existing: number): boolean {
  return existing < LETTERS_PER_CLUB_MAX;
}

export function isClubLetterKind(value: unknown): value is ClubLetterKindValue {
  return typeof value === "string" && (CLUB_LETTER_KINDS as readonly string[]).includes(value);
}

/**
 * Who may write and print letters: the club's director and deputy, the same capability that edits the club profile and
 * switches optional features. A registrar and a reporter cannot. Area Coordinators and conference staff have no way in;
 * staff acting as the club's director count as the director.
 */
export function canManageClubLetters(capabilities: Pick<ClubCapabilities, "editProfile">): boolean {
  return capabilities.editProfile;
}

/** The roster person ids a print asks for, from the `people` query value: distinct, non-empty, at most the cap. */
export function parsePrintPersonIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id && id.length <= 64 && !ids.includes(id)) ids.push(id);
    if (ids.length >= PRINT_PEOPLE_MAX) break;
  }
  return ids;
}

export type ClubLetterView = {
  id: string;
  kind: ClubLetterKindValue;
  title: string;
  body: string;
  /** ISO timestamp. */
  updatedAt: string;
};
