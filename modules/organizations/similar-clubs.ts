import { normalizeOrganizationName } from "@/modules/organizations/domain";

/**
 * The directory's duplicate check for a new club (#1031): which clubs already in the directory a typed name could be.
 * Pure and free of database access so the rules are unit-testable; `listSimilarClubCandidates` in the repository feeds it.
 *
 * Names are compared on a key: normalized, punctuation and the words every Adventist club name shares ("Pathfinder", "Club",
 * "SDA", "Church"...) removed, and "Mt/Mount", "St/Saint", "1st/First" written one way, so "Albia SDA Pathfinder Club" and
 * "Albia Pathfinders" meet.
 */

/** A club already in the directory, with where it is: its sponsoring church and that church's town. */
export type SimilarClubCandidate = {
  id: string;
  name: string;
  isActive: boolean;
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
  isActive: boolean;
  sponsorName: string | null;
  city: string | null;
  /** SAME_NAME: the very same name once spacing and case are ignored. SIMILAR_NAME: close to it, or another club of the same church. */
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

/** Abbreviations written one way, so "Mt Pleasant" and "Mount Pleasant" are the same name. */
const WORD_FORMS: Record<string, string> = {
  mt: "mount", st: "saint", "1st": "first", "2nd": "second", "3rd": "third",
};

/** The name's comparison key; empty when nothing but filler words remain. */
export function clubNameKey(name: string) {
  return normalizeOrganizationName(name)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !FILLER_WORDS.has(word))
    .map((word) => WORD_FORMS[word] ?? word)
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

export function namesAreClose(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  // One name inside the other ("albia" in "albia first"), but not a stray letter or two.
  if (shorter.length >= 4 && longer.includes(shorter)) return true;
  return editDistance(a, b) <= Math.max(1, Math.floor(shorter.length * 0.2));
}

/**
 * The directory clubs a typed name could be: the same name or a close one, anywhere, and every club the chosen sponsoring church
 * already has, whatever its name (a church rarely has two clubs of one kind, and a name of nothing but filler words matches
 * nothing else). Inactive clubs are included, marked so staff can tell. An active club of the very same name comes first, then
 * ones at the same sponsoring church or in the same town, then the same name before a close one, then by name. The WHOLE list:
 * `addClubBlock` must see every match, so only what is shown is cut, with `shownMatches`.
 */
export function similarClubMatches(name: string, place: NewClubPlace, candidates: readonly SimilarClubCandidate[]): SimilarClub[] {
  const normalized = normalizeOrganizationName(name);
  const key = clubNameKey(name);
  const here = townKey(place.city, place.state);
  const matches: SimilarClub[] = [];
  for (const candidate of candidates) {
    const candidateNormalized = normalizeOrganizationName(candidate.name);
    const same = candidateNormalized === normalized || (key !== "" && key === clubNameKey(candidate.name));
    const sameSponsor = place.sponsorId !== null && candidate.sponsorId === place.sponsorId;
    if (!same && !sameSponsor && !namesAreClose(key, clubNameKey(candidate.name))) continue;
    const there = townKey(candidate.city, candidate.state);
    matches.push({
      id: candidate.id,
      name: candidate.name,
      isActive: candidate.isActive,
      sponsorName: candidate.sponsorName,
      city: candidate.city,
      kind: candidateNormalized === normalized ? "SAME_NAME" : "SIMILAR_NAME",
      sameSponsor,
      sameArea: here !== null && here === there,
    });
  }
  const rank = (match: SimilarClub) => (match.kind === "SAME_NAME" && match.isActive ? -1 : (match.sameSponsor ? 0 : match.sameArea ? 1 : 2) * 2 + (match.kind === "SAME_NAME" ? 0 : 1));
  return matches.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The matches staff are shown: the first `SIMILAR_CLUBS_LIMIT`, an exact-name club always among them. Never use it to decide a block. */
export function shownMatches(matches: readonly SimilarClub[]): SimilarClub[] {
  return matches.slice(0, SIMILAR_CLUBS_LIMIT);
}

/**
 * Whether a new club can be added at all: never when an active club of the very same name is already in the directory, at any
 * church (the directory's club menu and the club match go by name, so a second one could never be picked; staff attach the team to
 * the existing club or give the new one a name that tells them apart); and when other close names exist, only once staff have
 * said none of them is the club.
 */
export function addClubBlock(matches: readonly SimilarClub[], acknowledgeSimilar: boolean): { code: "CLUB_EXISTS" | "SIMILAR_CLUBS"; message: string } | null {
  const twin = matches.find((match) => match.kind === "SAME_NAME" && match.isActive);
  if (twin) {
    return {
      code: "CLUB_EXISTS",
      message: `A club named ${twin.name}${twin.sponsorName ? ` (${twin.sponsorName})` : ""} is already in the directory. Attach the team to it, or give the new club a name that tells the two apart.`,
    };
  }
  if (matches.length > 0 && !acknowledgeSimilar) {
    return { code: "SIMILAR_CLUBS", message: "Clubs with a similar name, or other clubs of this church, are already in the directory. Check them, and attach the team to one of them if it is the same club." };
  }
  return null;
}
