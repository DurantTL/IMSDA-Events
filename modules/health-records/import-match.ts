import { churchStem } from "@/modules/club-imports/domain";
import { normalizeOrganizationName } from "@/modules/organizations/domain";
import type { ParsedHealthEntry } from "@/modules/health-records/import-parser";

/**
 * Matching an imported entry to a roster member (#878). Pure: it works on a
 * snapshot of the clubs and their current-year rosters that the repository
 * loads, and it returns an outcome per entry. No health value is involved.
 *
 * The rule: the club (the church and club name the parent typed, matched to a
 * club or its sponsoring church), then first and last name, and then ONE
 * confirmation: the same birth date, or the parent's email on the roster
 * member's guardian contacts. A name alone is never enough, because two
 * children can share a name. When more than one member fits, or the name fits
 * but nothing confirms it, the row is NEEDS CHECK and is not imported.
 */

export type MatchClub = {
  organizationId: string;
  name: string;
  normalizedName: string;
  sponsorName: string | null;
};

export type MatchMember = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  /** Year-month-day, or null when the roster has none. */
  birthDate: string | null;
  /** Lower-cased guardian contact emails on the roster row. */
  guardianEmails: string[];
  /** The member already has a health record (this year's row, or the same person's earlier year in this club). */
  hasRecord: boolean;
};

export type ImportOutcome =
  | "MATCHED"
  | "NEEDS_CHECK"
  | "UNMATCHED"
  | "ALREADY_HAS_RECORD"
  | "SUPERSEDED"
  | "INCOMPLETE";

export type MatchReason =
  | "CLUB_NOT_FOUND"
  | "CLUB_AMBIGUOUS"
  | "MEMBER_NOT_FOUND"
  | "SEVERAL_MEMBERS"
  | "NOT_CONFIRMED"
  | "BIRTH_DATE_DIFFERS";

export type EntryMatch = {
  sourceId: string;
  outcome: ImportOutcome;
  reason: MatchReason | null;
  /** What confirmed a MATCHED row. */
  via: "BIRTH_DATE" | "PARENT_EMAIL" | null;
  organizationId: string | null;
  clubName: string | null;
  memberId: string | null;
};

const nameKey = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Albany SDA Church Pathfinder Club" and "Albany Pathfinders" share the stem "albany". */
export function clubNameStem(value: string) {
  return churchStem(value).replace(/\b(pathfinders?|pathfinder club|club|clubs)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** The clubs a typed church and club name could mean. Exact name first, then the stem of the club or its church. */
export function clubsForText(clubText: string, clubs: MatchClub[]): MatchClub[] {
  const exact = clubs.filter((club) => club.normalizedName === normalizeOrganizationName(clubText));
  if (exact.length > 0) return exact;
  const stem = clubNameStem(clubText);
  if (!stem) return [];
  return clubs.filter((club) => clubNameStem(club.name) === stem || (club.sponsorName !== null && clubNameStem(club.sponsorName) === stem));
}

function unresolved(entry: ParsedHealthEntry, outcome: "NEEDS_CHECK" | "UNMATCHED", reason: MatchReason, club: MatchClub | null = null): EntryMatch {
  return { sourceId: entry.sourceId, outcome, reason, via: null, organizationId: club?.organizationId ?? null, clubName: club?.name ?? null, memberId: null };
}

export function matchEntry(entry: ParsedHealthEntry, clubs: MatchClub[], membersByClub: Map<string, MatchMember[]>): EntryMatch {
  if (entry.incomplete) {
    return { sourceId: entry.sourceId, outcome: "INCOMPLETE", reason: null, via: null, organizationId: null, clubName: null, memberId: null };
  }
  const candidatesClubs = clubsForText(entry.clubText, clubs);
  if (candidatesClubs.length === 0) return unresolved(entry, "UNMATCHED", "CLUB_NOT_FOUND");
  if (candidatesClubs.length > 1) return unresolved(entry, "NEEDS_CHECK", "CLUB_AMBIGUOUS");
  const club = candidatesClubs[0]!;
  const first = nameKey(entry.firstName);
  const last = nameKey(entry.lastName);
  const named = (membersByClub.get(club.organizationId) ?? []).filter((member) => nameKey(member.firstName) === first && nameKey(member.lastName) === last);
  if (named.length === 0) return unresolved(entry, "UNMATCHED", "MEMBER_NOT_FOUND", club);

  const confirmations = named.map((member) => ({
    member,
    byBirthDate: entry.birthDate !== null && member.birthDate !== null && entry.birthDate === member.birthDate,
    byEmail: entry.guardianEmail !== "" && member.guardianEmails.includes(entry.guardianEmail),
  }));
  const confirmed = confirmations.filter((item) => item.byBirthDate || item.byEmail);
  if (confirmed.length === 1) {
    const item = confirmed[0]!;
    return {
      sourceId: entry.sourceId,
      outcome: "MATCHED",
      reason: null,
      via: item.byBirthDate ? "BIRTH_DATE" : "PARENT_EMAIL",
      organizationId: club.organizationId,
      clubName: club.name,
      memberId: item.member.id,
    };
  }
  if (confirmed.length > 1) return unresolved(entry, "NEEDS_CHECK", "SEVERAL_MEMBERS", club);
  if (named.length > 1) return unresolved(entry, "NEEDS_CHECK", "SEVERAL_MEMBERS", club);
  // One name fits but neither the birth date nor the parent's email agrees (or one side has none).
  const onlyOne = confirmations[0]!;
  const bothDates = entry.birthDate !== null && onlyOne.member.birthDate !== null;
  return unresolved(entry, "NEEDS_CHECK", bothDates ? "BIRTH_DATE_DIFFERS" : "NOT_CONFIRMED", club);
}

/**
 * Decides every entry. Two more rules apply after matching:
 * - a member who already has a record is skipped (the newer entry wins, and a
 *   record in the new system is always newer than the old online form);
 * - when two entries match one member, only the latest-submitted is used and the
 *   other is SUPERSEDED (a tie goes to the later row).
 */
export function matchEntries(entries: ParsedHealthEntry[], clubs: MatchClub[], members: MatchMember[]): EntryMatch[] {
  const membersByClub = new Map<string, MatchMember[]>();
  for (const member of members) membersByClub.set(member.organizationId, [...(membersByClub.get(member.organizationId) ?? []), member]);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const matches = entries.map((entry) => matchEntry(entry, clubs, membersByClub));

  const winner = new Map<string, number>();
  matches.forEach((match, index) => {
    if (match.outcome !== "MATCHED" || !match.memberId) return;
    const current = winner.get(match.memberId);
    if (current === undefined || entries[index]!.submittedAt >= entries[current]!.submittedAt) winner.set(match.memberId, index);
  });
  return matches.map((match, index) => {
    if (match.outcome !== "MATCHED" || !match.memberId) return match;
    if (memberById.get(match.memberId)?.hasRecord) return { ...match, outcome: "ALREADY_HAS_RECORD" as const };
    if (winner.get(match.memberId) !== index) return { ...match, outcome: "SUPERSEDED" as const };
    return match;
  });
}

export function emptyOutcomeCounts(): Record<ImportOutcome, number> {
  return { MATCHED: 0, NEEDS_CHECK: 0, UNMATCHED: 0, ALREADY_HAS_RECORD: 0, SUPERSEDED: 0, INCOMPLETE: 0 };
}

export function countOutcomes(matches: Array<Pick<EntryMatch, "outcome">>) {
  const counts = emptyOutcomeCounts();
  for (const match of matches) counts[match.outcome] += 1;
  return counts;
}

export const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  CLUB_NOT_FOUND: "No club matches the church and club name on the form.",
  CLUB_AMBIGUOUS: "More than one club matches the church and club name on the form.",
  MEMBER_NOT_FOUND: "Nobody with this name is on the club's roster this year.",
  SEVERAL_MEMBERS: "More than one roster member fits this name and details.",
  NOT_CONFIRMED: "A roster member has this name, but neither the birth date nor the parent's email confirms it.",
  BIRTH_DATE_DIFFERS: "A roster member has this name but a different birth date.",
};
