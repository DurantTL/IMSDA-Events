import { describe, expect, it } from "vitest";
import { markedDeadlineCount, planFeedSync, hashImportedFields, type FeedDefaults, type StoredFeedEntry } from "@/modules/calendar/feed-plan";
import { importedFieldNames, parseIcsFeed, type ImportedEntry } from "@/modules/calendar/ics-import";

/**
 * Automatic Deadline marking on import (#910): titles from the issue become Deadlines when first imported, a
 * refresh follows a changed title until staff choose the type, and a staff choice always survives a refresh.
 */
const defaults: FeedDefaults = { publishNewItems: false, defaultCategory: "", defaultEntryType: "STANDARD" };

const ics = (events: Array<{ uid: string; title: string; day: string }>) => [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//Deadlines//EN",
  ...events.flatMap(({ uid, title, day }) => [
    "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20261001T000000Z", `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${day}`, `SUMMARY:${title}`, "END:VEVENT",
  ]),
  "END:VCALENDAR",
].join("\r\n");

const titles = {
  "a@d.test": "Spring Camporee Registration Due",
  "b@d.test": "All points and Investiture Reports are Due",
  "c@d.test": "Pathfinder and TLT of the Year Nominations Due",
  "d@d.test": "Fall Camporee",
  "e@d.test": "Office closed due to weather",
};
const feed = (overrides: Record<string, string> = {}) =>
  parseIcsFeed(ics(Object.entries({ ...titles, ...overrides }).map(([uid, title], index) => ({ uid, title, day: `2026120${index + 1}` })))).entries;

function stored(entry: ImportedEntry, patch: Partial<StoredFeedEntry> = {}): StoredFeedEntry {
  return {
    id: `row-${entry.uid}`, title: entry.title, description: entry.description, location: entry.location, linkUrl: entry.linkUrl,
    status: entry.status, startsOn: entry.startsOn, endsOn: entry.endsOn, timeLabel: entry.timeLabel, repeatRule: entry.repeatRule,
    repeatExceptions: entry.repeatExceptions, sourceUid: entry.uid, sourceRecurrenceId: entry.recurrenceId,
    sourceHash: hashImportedFields(entry), sourceRemovedAt: null, sourceRemovedWasPublished: false, locallyEditedFields: [],
    isPublished: false, entryType: "STANDARD", ...patch,
  };
}

describe("a new import marks items that say they are due", () => {
  it("marks the issue's examples as Deadlines and leaves everything else Standard", () => {
    const plan = planFeedSync([], feed(), defaults);
    const typeOf = (uid: string) => plan.creates.find((created) => created.entry.uid === uid)!.data.entryType;
    expect(typeOf("a@d.test")).toBe("DEADLINE");
    expect(typeOf("b@d.test")).toBe("DEADLINE");
    expect(typeOf("c@d.test")).toBe("DEADLINE");
    expect(typeOf("d@d.test")).toBe("STANDARD");
    expect(typeOf("e@d.test")).toBe("STANDARD"); // "due to" a cause is not a deadline
  });

  it("keeps the feed's own Closure default for everything", () => {
    const plan = planFeedSync([], feed(), { ...defaults, defaultEntryType: "CLOSURE" });
    expect(plan.creates.every((created) => created.data.entryType === "CLOSURE")).toBe(true);
  });

  it("does not make the type part of the imported fields or the change hash", () => {
    expect((importedFieldNames as readonly string[]).includes("entryType")).toBe(false);
  });
});

describe("a refresh and the type", () => {
  const entries = feed();
  const byUid = (uid: string) => entries.find((entry) => entry.uid === uid)!;

  it("does not silently re-type an item already on the calendar (imported before deadlines existed)", () => {
    const rows = [stored(byUid("a@d.test"))]; // Standard, though its title says it is due
    const plan = planFeedSync(rows, [byUid("a@d.test")], defaults);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
    expect(markedDeadlineCount(plan)).toBe(0);
  });

  it("types it once its title changes in the feed, and counts what was marked", () => {
    const rows = [stored(byUid("a@d.test"))];
    const changed = { ...byUid("a@d.test"), title: "Spring Camporee Registration Due (extended)" };
    const plan = planFeedSync(rows, [changed], defaults);
    expect(plan.updates[0].patch.entryType).toBe("DEADLINE");
    expect(markedDeadlineCount(plan)).toBe(1);
    expect(markedDeadlineCount(planFeedSync([], feed(), defaults))).toBe(3);
  });

  it("re-reads the rule after reset to source (the hash is cleared)", () => {
    const rows = [stored(byUid("a@d.test"), { sourceHash: null })];
    expect(planFeedSync(rows, [byUid("a@d.test")], defaults).updates[0].patch.entryType).toBe("DEADLINE");
  });

  it("follows a changed title until staff choose the type", () => {
    const renamed = { ...byUid("d@d.test"), title: "Fall Camporee Registration Due" };
    const plan = planFeedSync([stored(byUid("d@d.test"))], [renamed], defaults);
    expect(plan.updates[0].patch).toMatchObject({ title: "Fall Camporee Registration Due", entryType: "DEADLINE" });
    const back = { ...byUid("a@d.test"), title: "Spring Camporee" };
    const planBack = planFeedSync([stored(byUid("a@d.test"), { entryType: "DEADLINE" })], [back], defaults);
    expect(planBack.updates[0].patch).toMatchObject({ title: "Spring Camporee", entryType: "STANDARD" });
  });

  it("never overrides a type staff set (cleared a Deadline, or made one)", () => {
    const cleared = [stored(byUid("a@d.test"), { entryType: "STANDARD", locallyEditedFields: ["entryType"] })];
    const planCleared = planFeedSync(cleared, [byUid("a@d.test")], defaults);
    expect(planCleared.updates).toHaveLength(0);
    expect(planCleared.unchanged).toBe(1);
    // Even when the feed's title changes in the same refresh.
    const changed = { ...byUid("a@d.test"), title: "Spring Camporee Registration Due (extended)" };
    const planChanged = planFeedSync(cleared, [changed], defaults);
    expect(planChanged.updates[0].patch.entryType).toBeUndefined();
    expect(planChanged.updates[0].patch.title).toBe("Spring Camporee Registration Due (extended)");

    const made = [stored(byUid("d@d.test"), { entryType: "DEADLINE", locallyEditedFields: ["entryType"] })];
    const planMade = planFeedSync(made, [byUid("d@d.test")], defaults);
    expect(planMade.updates).toHaveLength(0);
  });

  it("does not let the feed's title drive the type once staff edited the title", () => {
    const rows = [stored(byUid("d@d.test"), { title: "Fall Camporee (our name)", locallyEditedFields: ["title"] })];
    const renamed = { ...byUid("d@d.test"), title: "Fall Camporee Registration Due" };
    const plan = planFeedSync(rows, [renamed], defaults);
    expect(plan.updates.every((update) => update.patch.entryType === undefined)).toBe(true);
  });

  it("leaves a Closure alone", () => {
    const rows = [stored(byUid("a@d.test"), { entryType: "CLOSURE" })];
    const plan = planFeedSync(rows, [byUid("a@d.test")], defaults);
    expect(plan.updates).toHaveLength(0);
  });
});
