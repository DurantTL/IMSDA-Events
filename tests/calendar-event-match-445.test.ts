import { describe, expect, it } from "vitest";
import {
  dismissalKey,
  entryCanBeLinked,
  findPossibleMatches,
  titleTokens,
  titlesSimilar,
  type MatchEntry,
  type MatchEvent,
} from "@/modules/calendar/event-match";

const entry = (overrides: Partial<MatchEntry> = {}): MatchEntry => ({
  id: "entry-1",
  title: "Womens Retreat",
  startsOn: "2026-10-09",
  endsOn: "2026-10-11",
  entryType: "STANDARD",
  hasRepeat: false,
  isImported: true,
  linkedEventId: null,
  isHiddenLocally: false,
  sourceRemoved: false,
  ...overrides,
});
const event = (overrides: Partial<MatchEvent> = {}): MatchEvent => ({
  id: "event-1",
  name: "Women's Retreat 2026",
  startsOn: "2026-10-09",
  endsOn: "2026-10-11",
  ...overrides,
});
const none = new Set<string>();

describe("title similarity (#445)", () => {
  it("ignores case, punctuation, years and filler words", () => {
    expect(titleTokens("The Women's Retreat 2026!")).toEqual(["womens", "retreat"]);
    expect(titleTokens("  CAMP-MEETING  (2027) ")).toEqual(["camp", "meeting"]);
    expect(titlesSimilar("Womens Retreat", "Women's Retreat 2026")).toBe(true);
    expect(titlesSimilar("THE Camp Meeting", "camp-meeting 2026")).toBe(true);
    expect(titlesSimilar("Men's Convention", "mens convention")).toBe(true);
  });

  it("tolerates one slipped letter in a long word and a longer title around the same name", () => {
    expect(titlesSimilar("Womans Retreat", "Women's Retreat")).toBe(true);
    expect(titlesSimilar("Camp Meeting", "Camp Meeting Weekend 2026")).toBe(true);
  });

  it("treats qualifier words and numbers as differences, not as noise", () => {
    expect(titlesSimilar("Spanish Camp Meeting", "Camp Meeting")).toBe(false);
    expect(titlesSimilar("Hispanic Camp Meeting 2026", "Camp Meeting 2026")).toBe(false);
    expect(titlesSimilar("Week 1", "Week 2")).toBe(false);
    expect(titlesSimilar("Junior Camp Week 1", "Junior Camp Week 2")).toBe(false);
    expect(titlesSimilar("Junior Camp", "Junior Camp Staff Training")).toBe(false);
    expect(titlesSimilar("Camp Setup", "Camp")).toBe(false);
    expect(titlesSimilar("Camp Planning Meeting", "Camp Meeting")).toBe(false);
    expect(titlesSimilar("PBE Area Level", "PBE Conference Level")).toBe(false);
    // The same qualifiers on both sides still match, in any order, and a year is never a qualifier.
    expect(titlesSimilar("Spanish Camp Meeting 2026", "Camp Meeting Spanish")).toBe(true);
    expect(titlesSimilar("Junior Camp Week 2", "Junior Camp - Week 2 (2026)")).toBe(true);
  });

  it("does not call a one-word title a match for a longer one", () => {
    expect(titlesSimilar("Retreat", "Women's Retreat")).toBe(false);
    expect(titlesSimilar("Camporee", "Spring Camporee 2026")).toBe(false);
    expect(titlesSimilar("Retreat", "Retreat 2026")).toBe(true);
  });

  it("does not match different events", () => {
    expect(titlesSimilar("Spring Camporee", "Fall Camporee")).toBe(false);
    expect(titlesSimilar("Men's Convention", "Women's Retreat")).toBe(false);
    expect(titlesSimilar("2026", "The")).toBe(false);
  });
});

describe("possible matches (#445)", () => {
  it("flags an imported item whose dates overlap an event with a similar title", () => {
    expect(findPossibleMatches([entry()], [event()], none, none)).toEqual([{ entryId: "entry-1", eventId: "event-1" }]);
    // Overlap, not equality: a day of the retreat is enough.
    expect(findPossibleMatches([entry({ startsOn: "2026-10-11", endsOn: "2026-10-11" })], [event()], none, none)).toHaveLength(1);
  });

  it("needs both overlapping dates and a similar title", () => {
    expect(findPossibleMatches([entry({ startsOn: "2026-11-09", endsOn: "2026-11-11" })], [event()], none, none)).toEqual([]);
    expect(findPossibleMatches([entry({ title: "Spring Camporee" })], [event()], none, none)).toEqual([]);
  });

  it("never flags staff-made items, linked items, closures, deadlines, repeating, hidden or removed items", () => {
    for (const overrides of [
      { isImported: false },
      { linkedEventId: "event-9" },
      { entryType: "CLOSURE" as const },
      { entryType: "DEADLINE" as const },
      { hasRepeat: true },
      { isHiddenLocally: true },
      { sourceRemoved: true },
    ]) {
      expect(findPossibleMatches([entry(overrides)], [event()], none, none)).toEqual([]);
    }
  });

  it("leaves out an event already linked to another item", () => {
    expect(findPossibleMatches([entry()], [event()], none, new Set(["event-1"]))).toEqual([]);
  });

  it("\"Not the same\" removes that pair only, for good", () => {
    const other = event({ id: "event-2", name: "Womens Retreat Overflow" });
    const dismissed = new Set([dismissalKey("entry-1", "event-1")]);
    expect(findPossibleMatches([entry()], [event()], dismissed, none)).toEqual([]);
    expect(findPossibleMatches([entry()], [event(), other], dismissed, none)).toEqual([{ entryId: "entry-1", eventId: "event-2" }]);
  });

  it("suggests one event per item: the one whose start date is closest", () => {
    const later = event({ id: "event-2", startsOn: "2026-10-10" });
    const same = event({ id: "event-3", startsOn: "2026-10-09" });
    expect(findPossibleMatches([entry()], [later, same], none, none)).toEqual([{ entryId: "entry-1", eventId: "event-3" }]);
    // Neither starts on the item's day: the nearer one wins, whichever side of it.
    const earlyItem = entry({ startsOn: "2026-10-09", endsOn: "2026-10-14" });
    const far = event({ id: "event-4", startsOn: "2026-10-13", endsOn: "2026-10-14" });
    const near = event({ id: "event-5", startsOn: "2026-10-07", endsOn: "2026-10-10" });
    expect(findPossibleMatches([earlyItem], [far, near], none, none)).toEqual([{ entryId: "entry-1", eventId: "event-5" }]);
  });

  it("doesn't flag the false positives the review found", () => {
    const pairs: Array<[string, string]> = [
      ["Camp Meeting", "Spanish Camp Meeting"],
      ["Week 1", "Week 2"],
      ["Junior Camp", "Junior Camp Staff Training"],
      ["PBE Area Level", "PBE Conference Level"],
      ["Retreat", "Women's Retreat"],
    ];
    for (const [itemTitle, eventName] of pairs) {
      expect(findPossibleMatches([entry({ title: itemTitle })], [event({ name: eventName })], none, none)).toEqual([]);
    }
  });

  it("only an ordinary one-time item can be linked", () => {
    expect(entryCanBeLinked({ entryType: "STANDARD", hasRepeat: false })).toBe(true);
    expect(entryCanBeLinked({ entryType: "STANDARD", hasRepeat: true })).toBe(false);
    expect(entryCanBeLinked({ entryType: "CLOSURE", hasRepeat: false })).toBe(false);
    expect(entryCanBeLinked({ entryType: "DEADLINE", hasRepeat: false })).toBe(false);
  });
});
