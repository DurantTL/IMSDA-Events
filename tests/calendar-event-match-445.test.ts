import { describe, expect, it } from "vitest";
import {
  buildDatePreview,
  datePromptMessage,
  datesNeedDecision,
} from "@/modules/calendar/event-dates";
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

  it("suggests one event per item, preferring the same start date", () => {
    const later = event({ id: "event-2", startsOn: "2026-10-10" });
    const same = event({ id: "event-3", startsOn: "2026-10-09" });
    expect(findPossibleMatches([entry()], [later, same], none, none)).toEqual([{ entryId: "entry-1", eventId: "event-3" }]);
  });

  it("only an ordinary one-time item can be linked", () => {
    expect(entryCanBeLinked({ entryType: "STANDARD", hasRepeat: false })).toBe(true);
    expect(entryCanBeLinked({ entryType: "STANDARD", hasRepeat: true })).toBe(false);
    expect(entryCanBeLinked({ entryType: "CLOSURE", hasRepeat: false })).toBe(false);
    expect(entryCanBeLinked({ entryType: "DEADLINE", hasRepeat: false })).toBe(false);
  });
});

describe("date change decision (#445)", () => {
  const same = { itemStartsOn: "2026-10-09", itemEndsOn: "2026-10-11", eventStartsOn: "2026-10-09", eventEndsOn: "2026-10-11", keptStartsOn: null, keptEndsOn: null };

  it("asks only when the item's dates differ from the event's", () => {
    expect(datesNeedDecision(same)).toBe(false);
    expect(datesNeedDecision({ ...same, itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" })).toBe(true);
    expect(datesNeedDecision({ ...same, itemEndsOn: "2026-10-12" })).toBe(true);
  });

  it("stays quiet after Keep, until the item moves again", () => {
    const moved = { ...same, itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" };
    expect(datesNeedDecision({ ...moved, keptStartsOn: "2026-11-07", keptEndsOn: "2026-11-09" })).toBe(false);
    expect(datesNeedDecision({ ...moved, keptStartsOn: "2026-11-07", keptEndsOn: "2026-11-08" })).toBe(true);
  });

  it("words the question the way the owner asked for it", () => {
    expect(datePromptMessage({ imported: true, itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" }))
      .toBe("Google Calendar moved this event to November 7–9, 2026. Update the registration dates?");
    expect(datePromptMessage({ imported: false, itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" }))
      .toBe("The calendar item for this event now says November 7–9, 2026. Update the registration dates?");
  });

  const base = {
    startsOn: "2026-10-09",
    endsOn: "2026-10-11",
    registrationOpensOn: "2026-08-01",
    registrationClosesOn: "2026-10-05",
    seminarPreferenceClosesOn: null,
    locations: [{ name: "Site A", firstDay: "2026-10-09", lastDay: "2026-10-11", registrationClosesOn: null }],
    lodging: { firstNight: "2026-10-09", lastNight: "2026-10-10", preferencesDeadline: "2026-10-01" },
  };

  it("previews the new dates and lists dependent dates that stay exactly as they are", () => {
    const preview = buildDatePreview(base, { startsOn: "2026-11-07", endsOn: "2026-11-09" });
    expect(preview.changes).toEqual([{ label: "Event dates", from: "October 9–11, 2026", to: "November 7–9, 2026" }]);
    expect(preview.blockedReason).toBeNull();
    const labels = preview.unchanged.map((item) => item.label);
    expect(labels).toEqual(["Registration opens", "Registration closes", "Site A: days", "Lodging nights", "Lodging preferences close"]);
    // Location days and lodging nights are now outside the new dates, and say so.
    expect(preview.unchanged.find((item) => item.label === "Site A: days")?.needsAttention).toBe(true);
    expect(preview.unchanged.find((item) => item.label === "Lodging nights")?.needsAttention).toBe(true);
    expect(preview.unchanged.find((item) => item.label === "Registration closes")?.needsAttention).toBe(false);
  });

  it("flags registration that would close after the event, and refuses one that would open after it", () => {
    const earlier = buildDatePreview(base, { startsOn: "2026-09-25", endsOn: "2026-09-27" });
    expect(earlier.unchanged.find((item) => item.label === "Registration closes")?.needsAttention).toBe(true);
    expect(earlier.blockedReason).toBeNull();
    const blocked = buildDatePreview({ ...base, registrationOpensOn: "2026-10-20" }, { startsOn: "2026-10-09", endsOn: "2026-10-11" });
    expect(blocked.blockedReason).toMatch(/open after the new last day/);
  });
});
