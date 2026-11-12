import { z } from "zod";

/**
 * Event recognitions (#1683): the pins, patches and stars staff mark during a club event. A recognition is an event tag that
 * records what it earns (`EventTag.recognitionItem`); marking one is the audited attendee tag path. This file is pure: the
 * names, the totals and the per-club hand-out list.
 */

export const RECOGNITION_MODULE_KEY = "recognitions" as const;

export const recognitionItems = ["PIN", "PATCH", "STAR"] as const;
export type RecognitionItemValue = (typeof recognitionItems)[number];

export const recognitionItemLabels: Record<RecognitionItemValue, { singular: string; plural: string }> = {
  PIN: { singular: "pin", plural: "pins" },
  PATCH: { singular: "patch", plural: "patches" },
  STAR: { singular: "star", plural: "stars" },
};

/** Tags need a color; a recognition takes a fixed one by what it earns so staff never pick one. */
export const recognitionColors: Record<RecognitionItemValue, string> = { PIN: "#1D4ED8", PATCH: "#15803D", STAR: "#B45309" };

export const recognitionInputSchema = z.object({
  name: z.string().trim().min(2, "Name the recognition in at least 2 characters.").max(60, "Keep the name to 60 characters."),
  item: z.enum(recognitionItems),
});

export const switchInputSchema = z.object({ enabled: z.boolean() });

export const markInputSchema = z.object({
  attendeeId: z.string().trim().min(1),
  recognitionId: z.string().trim().min(1),
});

export const searchQuerySchema = z.string().trim().min(2).max(60);

export type RecognitionDefinition = { id: string; name: string; item: RecognitionItemValue; isActive: boolean };

/** One active mark: who earned which recognition, and the club (registration) they came with. */
export type RecognitionMark = {
  recognitionId: string;
  attendeeId: string;
  attendeeName: string;
  clubKey: string;
  clubName: string;
};

export type RecognitionSearchResult = { attendeeId: string; name: string; clubName: string; earnedRecognitionIds: string[] };

export type ItemCounts = Record<RecognitionItemValue, number>;
export const emptyItemCounts = (): ItemCounts => ({ PIN: 0, PATCH: 0, STAR: 0 });

export type RecognitionSummary = {
  perRecognition: Array<RecognitionDefinition & { count: number }>;
  perItem: ItemCounts;
  perClub: Array<{ clubKey: string; clubName: string; counts: ItemCounts; total: number }>;
  handOut: Array<{ clubKey: string; clubName: string; people: Array<{ attendeeId: string; name: string; earned: string[] }> }>;
};

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base", numeric: true });

/**
 * Totals and the hand-out list. A mark for a recognition that is not in `definitions` is ignored, and a repeated mark for the
 * same person and recognition counts once, so the order list can never be inflated. Names only; clubs and people sort by name.
 */
export function summarizeRecognitions(definitions: readonly RecognitionDefinition[], marks: readonly RecognitionMark[]): RecognitionSummary {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const seen = new Set<string>();
  const perRecognition = new Map(definitions.map((definition) => [definition.id, 0]));
  const perItem = emptyItemCounts();
  const clubs = new Map<string, { clubKey: string; clubName: string; counts: ItemCounts; people: Map<string, { attendeeId: string; name: string; earned: string[] }> }>();

  for (const mark of marks) {
    const definition = byId.get(mark.recognitionId);
    if (!definition) continue;
    const dedupe = `${mark.recognitionId}:${mark.attendeeId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    perRecognition.set(definition.id, (perRecognition.get(definition.id) ?? 0) + 1);
    perItem[definition.item] += 1;
    let club = clubs.get(mark.clubKey);
    if (!club) {
      club = { clubKey: mark.clubKey, clubName: mark.clubName, counts: emptyItemCounts(), people: new Map() };
      clubs.set(mark.clubKey, club);
    }
    club.counts[definition.item] += 1;
    const person = club.people.get(mark.attendeeId) ?? { attendeeId: mark.attendeeId, name: mark.attendeeName, earned: [] };
    person.earned.push(definition.name);
    club.people.set(mark.attendeeId, person);
  }

  const sortedClubs = [...clubs.values()].sort((a, b) => byName(a.clubName, b.clubName) || byName(a.clubKey, b.clubKey));
  return {
    perRecognition: definitions.map((definition) => ({ ...definition, count: perRecognition.get(definition.id) ?? 0 })),
    perItem,
    perClub: sortedClubs.map((club) => ({ clubKey: club.clubKey, clubName: club.clubName, counts: club.counts, total: club.counts.PIN + club.counts.PATCH + club.counts.STAR })),
    handOut: sortedClubs.map((club) => ({
      clubKey: club.clubKey,
      clubName: club.clubName,
      people: [...club.people.values()]
        .map((person) => ({ ...person, earned: [...person.earned].sort(byName) }))
        .sort((a, b) => byName(a.name, b.name) || byName(a.attendeeId, b.attendeeId)),
    })),
  };
}

/** "Mountain View (Blue team)" for a club's named team (#809); just the club name otherwise. */
export function clubLabel(name: string, teamName: string | null) {
  return teamName && teamName.trim() ? `${name} (${teamName.trim()})` : name;
}

/** The `<pins> pins, <patches> patches` line, leaving out an item nobody earned. */
export function describeItemCounts(counts: ItemCounts) {
  const parts = recognitionItems
    .filter((item) => counts[item] > 0)
    .map((item) => `${counts[item]} ${counts[item] === 1 ? recognitionItemLabels[item].singular : recognitionItemLabels[item].plural}`);
  return parts.length === 0 ? "Nothing marked yet" : parts.join(", ");
}
