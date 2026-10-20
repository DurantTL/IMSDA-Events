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

/**
 * Words that name a different event rather than the same one: "Spanish Camp Meeting" is not "Camp Meeting",
 * "Junior Camp Staff Training" is not "Junior Camp", and "Week 1" is not "Week 2". Numbers count too. If the two
 * titles don't carry exactly the same qualifiers they are not similar, whatever else they share.
 */
const qualifierWords = new Set(["spanish", "hispanic", "week", "staff", "training", "setup", "planning", "level"]);
const isQualifier = (token: string) => qualifierWords.has(token) || /^\d+$/.test(token);

/** True when two titles very probably name the same thing. */
export function titlesSimilar(first: string, second: string) {
  const all = [titleTokens(first), titleTokens(second)];
  const [qualifiersA, qualifiersB] = all.map((tokens) => tokens.filter(isQualifier).sort().join(" "));
  if (qualifiersA !== qualifiersB) return false;
  const [a, b] = all.map((tokens) => tokens.filter((token) => !isQualifier(token)));
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
  // A one-word title says too little to call another title a match: only the same word will do ("Retreat" is not "Women's Retreat").
  if (smaller < 2) return matched === smaller && a.length === b.length;
  // One title wholly inside the other ("Camp Meeting" in "Camp Meeting Weekend"), or most words shared.
  if (matched === smaller) return true;
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
 * Imported items that are not linked yet, whose dates overlap an event and whose
 * titles are similar, minus the pairs staff said are not the same. An event that
 * already has a linked item is still suggested (#1086): one registration can have
 * several calendar items. One suggestion per item: the event with the closest
 * start date.
 */
export function findPossibleMatches(
  entries: readonly MatchEntry[],
  events: readonly MatchEvent[],
  dismissed: ReadonlySet<string>,
): PossibleMatch[] {
  const matches: PossibleMatch[] = [];
  for (const entry of entries) {
    if (!entry.isImported || entry.linkedEventId || !entryCanBeLinked(entry) || entry.isHiddenLocally || entry.sourceRemoved) continue;
    const candidates = events
      .filter((event) => !dismissed.has(dismissalKey(entry.id, event.id))
        && datesOverlap(entry, event)
        && titlesSimilar(entry.title, event.name))
      .sort((a, b) => startGap(entry, a) - startGap(entry, b) || a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name));
    const best = candidates[0];
    if (best) matches.push({ entryId: entry.id, eventId: best.id });
  }
  return matches;
}

/** Days between two start dates, whichever comes first. */
function startGap(entry: { startsOn: string }, event: { startsOn: string }) {
  return Math.abs(Date.parse(`${entry.startsOn}T00:00:00Z`) - Date.parse(`${event.startsOn}T00:00:00Z`)) / 86_400_000;
}

export function dismissalKey(entryId: string, eventId: string) {
  return `${entryId}:${eventId}`;
}
