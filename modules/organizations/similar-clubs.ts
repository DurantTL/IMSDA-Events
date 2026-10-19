import { normalizeOrganizationName } from "@/modules/organizations/domain";

/**
 * The directory's duplicate check for a new club (#1031): which clubs already in the directory a typed name could be.
 * Pure and free of database access so the rules are unit-testable; `findSimilarClubs` in the repository feeds it.
 *
 * Names are compared on a key: normalized, punctuation and the words every Adventist club name shares ("Pathfinder", "Club",
 * "SDA", "Church"...) removed, so "Albia SDA Pathfinder Club" and "Albia Pathfinders" meet.
 */

/** A club already in the directory, with where it is: its sponsoring church and that church's town. */
export type SimilarClubCandidate = {
  id: string;
  name: string;
  sponsorId: string | null;
  sponsorName: string | null;
  city: string | null;
  state: string | null;
};

/** Where the new club would sit: its sponsoring church and that church's town. */
export type NewClubPlace = { sponsorId: string | null; city: string | null; state: string | null };

export type SimilarClub = {
  id: string;
  name: string;
  sponsorName: string | null;
  city: string | null;
  /** SAME_NAME: the very same name once spacing and case are ignored. SIMILAR_NAME: close to it. */
  kind: "SAME_NAME" | "SIMILAR_NAME";
  sameSponsor: boolean;
  /** The same town (city and state) as the new club's church. */
  sameArea: boolean;
};

export const SIMILAR_CLUBS_LIMIT = 8;

const FILLER_WORDS = new Set([
  "the", "of", "and", "club", "clubs", "pathfinder", "pathfinders", "adventurer", "adventurers", "sda", "seventh", "day",
  "adventist", "church", "company", "group", "tlt",
]);

/** The name's comparison key; empty when nothing but filler words remain. */
export function clubNameKey(name: string) {
  return normalizeOrganizationName(name)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !FILLER_WORDS.has(word))
    .join(" ");
}

/** Edit distance between two short strings. */
export function editDistance(a: string, b: string) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

function townKey(city: string | null, state: string | null) {
  const town = normalizeOrganizationName(city ?? "");
  return town ? `${town}|${normalizeOrganizationName(state ?? "")}` : null;
}

function namesAreClose(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  // One name inside the other ("albia" in "albia first"), but not a stray letter or two.
  if (shorter.length >= 4 && longer.includes(shorter)) return true;
  return editDistance(a, b) <= Math.max(1, Math.floor(shorter.length * 0.2));
}

/**
 * The directory clubs a typed name could be: the same name or a close one, anywhere. Ones at the same sponsoring church or in the
 * same town come first, then the same name before a close one, then by name. At most `SIMILAR_CLUBS_LIMIT`.
 */
export function similarClubMatches(name: string, place: NewClubPlace, candidates: readonly SimilarClubCandidate[]): SimilarClub[] {
  const normalized = normalizeOrganizationName(name);
  const key = clubNameKey(name);
  const here = townKey(place.city, place.state);
  const matches: SimilarClub[] = [];
  for (const candidate of candidates) {
    const candidateNormalized = normalizeOrganizationName(candidate.name);
    const same = candidateNormalized === normalized;
    if (!same && !namesAreClose(key, clubNameKey(candidate.name))) continue;
    const there = townKey(candidate.city, candidate.state);
    matches.push({
      id: candidate.id,
      name: candidate.name,
      sponsorName: candidate.sponsorName,
      city: candidate.city,
      kind: same ? "SAME_NAME" : "SIMILAR_NAME",
      sameSponsor: place.sponsorId !== null && candidate.sponsorId === place.sponsorId,
      sameArea: here !== null && here === there,
    });
  }
  const rank = (match: SimilarClub) => (match.sameSponsor ? 0 : match.sameArea ? 1 : 2) * 2 + (match.kind === "SAME_NAME" ? 0 : 1);
  return matches
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, SIMILAR_CLUBS_LIMIT);
}

/**
 * Whether a new club can be added at all: never when the same name is already a club of the same sponsoring church (that is the
 * same club); and when other close names exist, only once staff have said none of them is the club.
 */
export function addClubBlock(matches: readonly SimilarClub[], acknowledgeSimilar: boolean): { code: "CLUB_EXISTS" | "SIMILAR_CLUBS"; message: string } | null {
  const twin = matches.find((match) => match.kind === "SAME_NAME" && match.sameSponsor);
  if (twin) return { code: "CLUB_EXISTS", message: `A club named ${twin.name} is already in the directory for this church. Attach the team to it instead.` };
  if (matches.length > 0 && !acknowledgeSimilar) {
    return { code: "SIMILAR_CLUBS", message: "Clubs with a similar name are already in the directory. Check them, and attach the team to one of them if it is the same club." };
  }
  return null;
}
