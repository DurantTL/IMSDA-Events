/**
 * "Past years" on the director's Forms page (#1323). Pure grouping, with no
 * database: once a club has started the new year, every link and filled form
 * from an earlier club year moves out of the current lists. Nothing is
 * deleted and who may read a form never changes.
 */

type HasClubYear = { clubYear?: string | null };

/** The first year of a club year label like "2026-27", or null when it is not one. */
export function clubYearStartYear(clubYear: string | null | undefined) {
  const match = /^(\d{4})-\d{2}$/.exec(clubYear ?? "");
  return match ? Number(match[1]) : null;
}

/** True when `clubYear` is a real club year before `current`. A row with no year counts as current. */
export function isEarlierClubYear(clubYear: string | null | undefined, current: string) {
  const year = clubYearStartYear(clubYear);
  const now = clubYearStartYear(current);
  return year !== null && now !== null && year < now;
}

export type PastYearGroup<L, S> = { clubYear: string; links: L[]; submissions: S[] };

export type ClubFormsByYear<L, S> = {
  currentLinks: L[];
  currentSubmissions: S[];
  /** Newest club year first. Empty until the club has started the new year. */
  pastYears: PastYearGroup<L, S>[];
};

/**
 * Splits links and filled forms into the current lists and past club years.
 * Before the club has started `current`, everything stays in the current lists.
 * Each list keeps its incoming order. The caller filters by member before this,
 * so a member's filter applies to the current and the past lists alike.
 */
export function groupClubFormsByYear<L extends HasClubYear, S extends HasClubYear>(
  input: { links: L[]; submissions: S[]; currentClubYear: string; yearStarted: boolean },
): ClubFormsByYear<L, S> {
  if (!input.yearStarted) {
    return { currentLinks: input.links, currentSubmissions: input.submissions, pastYears: [] };
  }
  const years = new Map<string, PastYearGroup<L, S>>();
  const group = (clubYear: string) => {
    let entry = years.get(clubYear);
    if (!entry) {
      entry = { clubYear, links: [], submissions: [] };
      years.set(clubYear, entry);
    }
    return entry;
  };
  const currentLinks: L[] = [];
  const currentSubmissions: S[] = [];
  for (const link of input.links) {
    if (isEarlierClubYear(link.clubYear, input.currentClubYear)) group(link.clubYear!).links.push(link);
    else currentLinks.push(link);
  }
  for (const submission of input.submissions) {
    if (isEarlierClubYear(submission.clubYear, input.currentClubYear)) group(submission.clubYear!).submissions.push(submission);
    else currentSubmissions.push(submission);
  }
  const pastYears = [...years.values()].sort((a, b) => clubYearStartYear(b.clubYear)! - clubYearStartYear(a.clubYear)!);
  return { currentLinks, currentSubmissions, pastYears };
}

/** The "Start the new year" button shows only when there is something to move and the year is not started yet. */
export function showStartNewYear(state: { hasEarlierYears: boolean; yearStarted: boolean }) {
  return state.hasEarlierYears && !state.yearStarted;
}
