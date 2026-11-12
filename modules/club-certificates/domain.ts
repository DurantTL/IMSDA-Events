/**
 * Optional class and honor certificates (#1696), pure. A club's director or deputy picks completed honors and class
 * completions on their own roster and prints one landscape certificate each, or saves them as a PDF from the browser.
 * Nothing is sent. A certificate shows only a first and last name, what was completed, the date and the club: never a
 * birth date, a contact, a health detail or any other roster field.
 */

import { conferenceDateFormat } from "@/modules/calendar/conference-format";
import { clubClassLevelLabels, type ClubClassLevel } from "@/modules/club-rosters/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const CLUB_CERTIFICATES_FEATURE_KEY = "completion-certificates";

/** The most certificates one print view holds (the same cap as the fill-in letters). */
export const CERTIFICATES_PRINT_MAX = 200;

export const CERTIFICATE_KINDS = ["HONOR", "CLASS"] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export const certificateKindLabels: Record<CertificateKind, string> = { HONOR: "Honor", CLASS: "Class" };

/** Who may use certificates: the club's director and deputy (the profile-editing capability), like the fill-in letters. */
export function canManageClubCertificates(capabilities: Pick<ClubCapabilities, "editProfile">): boolean {
  return capabilities.editProfile;
}

/** One completed honor or class for one person on this club's roster. */
export type CertificateCandidate = {
  /** `h:<roster member id>:<honor id>` or `c:<roster member id>:<class level>`. */
  key: string;
  kind: CertificateKind;
  memberId: string;
  firstName: string;
  lastName: string;
  /** The honor's name or the class's name. */
  title: string;
  /** The completion date, `YYYY-MM-DD`. */
  completedOn: string;
};

export function certificateKey(kind: CertificateKind, memberId: string, refId: string): string {
  return `${kind === "HONOR" ? "h" : "c"}:${memberId}:${refId}`;
}

/** The class as it reads on a certificate: "Explorer Class", but "Basic Staff Training" and "TLT" as they are. */
export function classCertificateTitle(level: ClubClassLevel): string {
  const label = clubClassLevelLabels[level];
  return (["FRIEND", "COMPANION", "EXPLORER", "RANGER", "VOYAGER", "GUIDE"] as ClubClassLevel[]).includes(level) ? `${label} Class` : label;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether the text is a real calendar date written `YYYY-MM-DD`. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A calendar date as a long US date, such as "November 12, 2026"; the text itself when it is not a date. */
export function formatCompletionDate(value: string): string {
  if (!isCalendarDate(value)) return value;
  return conferenceDateFormat({ dateStyle: "long" }).format(new Date(`${value}T12:00:00Z`));
}

/** The honors this person currently has completed: only the current status counts (voided entries never do). */
export function honorCandidates(
  rows: ReadonlyArray<{ memberId: string; firstName: string; lastName: string; honors: ReadonlyArray<{ honorId: string; honorName: string; status: string; completionDate: string }> }>,
): CertificateCandidate[] {
  const out: CertificateCandidate[] = [];
  for (const row of rows) {
    for (const honor of row.honors) {
      if (honor.status !== "COMPLETED" || !isCalendarDate(honor.completionDate)) continue;
      out.push({ key: certificateKey("HONOR", row.memberId, honor.honorId), kind: "HONOR", memberId: row.memberId, firstName: row.firstName, lastName: row.lastName, title: honor.honorName, completedOn: honor.completionDate });
    }
  }
  return out;
}

export function classCandidates(
  rows: ReadonlyArray<{ memberId: string; firstName: string; lastName: string; classLevel: ClubClassLevel; completedOn: string }>,
): CertificateCandidate[] {
  return rows
    .filter((row) => isCalendarDate(row.completedOn))
    .map((row) => ({ key: certificateKey("CLASS", row.memberId, row.classLevel), kind: "CLASS" as const, memberId: row.memberId, firstName: row.firstName, lastName: row.lastName, title: classCertificateTitle(row.classLevel), completedOn: row.completedOn }));
}

/** Last name, first name, then newest completion first, then title: a steady order for the list and the print. */
export function sortCandidates(candidates: readonly CertificateCandidate[]): CertificateCandidate[] {
  return [...candidates].sort((a, b) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
    || b.completedOn.localeCompare(a.completedOn) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

export type CertificateFilter = { kind: CertificateKind | "ALL"; from: string; to: string };

/** The filter from the page's query: anything not valid is left out (all kinds, no date limit). */
export function parseCertificateFilter(query: { kind?: string | string[]; from?: string | string[]; to?: string | string[] }): CertificateFilter {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const kind = one(query.kind).toUpperCase();
  const from = one(query.from).trim();
  const to = one(query.to).trim();
  return {
    kind: kind === "HONOR" || kind === "CLASS" ? kind : "ALL",
    from: isCalendarDate(from) ? from : "",
    to: isCalendarDate(to) ? to : "",
  };
}

/** Candidates of the chosen kind whose completion date is within the range (both ends included; either may be blank). */
export function filterCandidates(candidates: readonly CertificateCandidate[], filter: CertificateFilter): CertificateCandidate[] {
  return candidates.filter((item) =>
    (filter.kind === "ALL" || item.kind === filter.kind)
    && (!filter.from || item.completedOn >= filter.from)
    && (!filter.to || item.completedOn <= filter.to));
}

/** The item keys a print asks for, from the `items` query: well formed, distinct, at most the cap. Anything else is skipped. */
export function parseCertificateItems(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  const keys: string[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (key.length === 0 || key.length > 140 || keys.includes(key)) continue;
    const pieces = key.split(":");
    if (pieces.length !== 3 || (pieces[0] !== "h" && pieces[0] !== "c") || !pieces[1] || !pieces[2]) continue;
    keys.push(key);
    if (keys.length >= CERTIFICATES_PRINT_MAX) break;
  }
  return keys;
}

/** The requested keys that are current completions on this club's roster, in the order asked; any other key is dropped. */
export function selectCertificates(keys: readonly string[], candidates: readonly CertificateCandidate[]): CertificateCandidate[] {
  const byKey = new Map(candidates.map((item) => [item.key, item]));
  const chosen: CertificateCandidate[] = [];
  for (const key of keys) {
    const found = byKey.get(key);
    if (found && !chosen.includes(found)) chosen.push(found);
  }
  return chosen.slice(0, CERTIFICATES_PRINT_MAX);
}

/** The `items` value for the print link. */
export function certificateItemsParam(keys: readonly string[]): string {
  return keys.map(encodeURIComponent).join(",");
}
