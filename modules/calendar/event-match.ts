/**
 * Possible matches between a calendar item and a registration event (#445).
 * Pure: the repository hands in rows, and nothing here ever links anything. A
 * match is only a flag in the calendar admin list; staff choose what to do.
 */

/** Words that say nothing about which event a title names. */
const fillerWords = new Set(["the", "a", "an", "of", "and", "for", "at", "in", "on", "to"]);

/**
 * A title reduced to what identifies it: lower case, accents and punctuation
 * dropped (an apostrophe joins its word, so "Women's" and "Womens" agree),
 * four-digit years and filler words removed.
 */
export function titleTokens(title: string): string[] {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  return cleaned
    .split(" ")
    .filter((token) => token !== "" && !/^(19|20)\d{2}$/.test(token) && !fillerWords.has(token));
}

function withinOneEdit(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Short words must match exactly: one letter apart is often a different word.
  if (Math.min(a.length, b.length) < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** True when two titles very probably name the same thing. */
export function titlesSimilar(first: string, second: string) {
  const a = titleTokens(first);
  const b = titleTokens(second);
  if (a.length === 0 || b.length === 0) return false;
  const unused = [...b];
  let matched = 0;
  for (const token of a) {
    const at = unused.findIndex((candidate) => withinOneEdit(token, candidate));
    if (at >= 0) {
      matched += 1;
      unused.splice(at, 1);
    }
  }
  const smaller = Math.min(a.length, b.length);
  // One title wholly inside the other ("Camp Meeting" in "Camp Meeting Weekend"), or most words shared.
  if (matched === smaller && smaller >= 2) return true;
  return (2 * matched) / (a.length + b.length) >= 0.6;
}

export function datesOverlap(first: { startsOn: string; endsOn: string }, second: { startsOn: string; endsOn: string }) {
  return first.startsOn <= second.endsOn && first.endsOn >= second.startsOn;
}

export type MatchEntry = {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  entryType: "STANDARD" | "CLOSURE" | "DEADLINE";
  hasRepeat: boolean;
  isImported: boolean;
  linkedEventId: string | null;
  isHiddenLocally: boolean;
  sourceRemoved: boolean;
};

export type MatchEvent = { id: string; name: string; startsOn: string; endsOn: string };

export type PossibleMatch = { entryId: string; eventId: string };

/** Whether a calendar item can stand in for a registration event at all: an ordinary one-off date. */
export function entryCanBeLinked(entry: Pick<MatchEntry, "entryType" | "hasRepeat">) {
  return entry.entryType === "STANDARD" && !entry.hasRepeat;
}

/**
 * Imported items that are not linked yet, whose dates overlap an event that is
 * not linked to another item and whose titles are similar, minus the pairs staff
 * said are not the same. One suggestion per item: the event with the closest
 * start date.
 */
export function findPossibleMatches(
  entries: readonly MatchEntry[],
  events: readonly MatchEvent[],
  dismissed: ReadonlySet<string>,
  linkedEventIds: ReadonlySet<string>,
): PossibleMatch[] {
  const matches: PossibleMatch[] = [];
  for (const entry of entries) {
    if (!entry.isImported || entry.linkedEventId || !entryCanBeLinked(entry) || entry.isHiddenLocally || entry.sourceRemoved) continue;
    const candidates = events
      .filter((event) => !linkedEventIds.has(event.id)
        && !dismissed.has(dismissalKey(entry.id, event.id))
        && datesOverlap(entry, event)
        && titlesSimilar(entry.title, event.name))
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name));
    const best = candidates.find((event) => event.startsOn === entry.startsOn) ?? candidates[0];
    if (best) matches.push({ entryId: entry.id, eventId: best.id });
  }
  return matches;
}

export function dismissalKey(entryId: string, eventId: string) {
  return `${entryId}:${eventId}`;
}
