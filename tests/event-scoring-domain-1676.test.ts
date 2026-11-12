import { describe, expect, it } from "vitest";
import {
  buildResults,
  buildScoredEventDefinition,
  eventScoringActionSchema,
  formatScore,
  ordinal,
  parseScoreText,
  rankEntries,
  resultsForClub,
  ribbonFor,
  scoreInputText,
  scoredEventInputSchema,
  type ScoredEventDefinition,
} from "@/modules/event-scoring/domain";
import { creationModuleKeys, defaultModuleKeys, eventModuleDefinition, moduleApplies, scopedToggleModuleKeys } from "@/modules/event-modules/catalog";

const clubs = new Map([
  ["club-a", { name: "Eagles", wantsRibbons: true }],
  ["club-b", { name: "Falcons", wantsRibbons: false }],
  ["club-c", { name: "Hawks", wantsRibbons: true }],
]);
const people = new Map([
  ["p-a1", { name: "Ada Sample", organizationId: "club-a" }],
  ["p-b1", { name: "Bea Sample", organizationId: "club-b" }],
  ["p-c1", { name: "Cy Sample", organizationId: "club-c" }],
]);
const stilts: ScoredEventDefinition = { id: "e-stilts", name: "Stilts", kind: "PATHFINDER", unit: "FEET", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [] };
const canoe: ScoredEventDefinition = { id: "e-canoe", name: "Canoe race", kind: "CLUB", unit: "TIME", higherWins: false, ribbonMode: "PLACES", ribbonPlaces: 2, ribbonBands: [] };
const verse: ScoredEventDefinition = { id: "e-verse", name: "Telephone verse", kind: "CLUB", unit: "POINTS", higherWins: true, ribbonMode: "BANDS", ribbonPlaces: 3, ribbonBands: [{ label: "Blue", thresholdHundredths: 9000 }, { label: "Red", thresholdHundredths: 7000 }] };

describe("camporee scoring is an optional tool (#1676)", () => {
  it("is off by default for every event and applies to club events only", () => {
    expect(eventModuleDefinition("event-scoring").offByDefault).toBe(true);
    expect(defaultModuleKeys("CLUB")).not.toContain("event-scoring");
    expect(moduleApplies("event-scoring", { audience: "CLUB" })).toBe(true);
    expect(moduleApplies("event-scoring", { audience: "GENERAL" })).toBe(false);
  });

  it("can be turned on when an event is created, and is left off otherwise (the Spring Camporee template)", () => {
    expect(creationModuleKeys("CLUB")).not.toContain("event-scoring");
    expect(creationModuleKeys("CLUB", [])).not.toContain("event-scoring");
    expect(creationModuleKeys("CLUB", ["event-scoring"])).toContain("event-scoring");
    expect(creationModuleKeys("GENERAL", ["event-scoring"])).not.toContain("event-scoring");
  });

  it("is switchable by the narrow path beside Club teachers, and by no other", () => {
    expect(scopedToggleModuleKeys).toEqual(["club-teachers", "event-scoring", "attendance-points", "debrief", "event-budget", "event-staffing"]);
  });
});

describe("scores as typed and shown (#1676)", () => {
  it("reads points and feet with up to two decimals", () => {
    expect(parseScoreText("POINTS", "85")).toEqual({ ok: true, hundredths: 8500 });
    expect(parseScoreText("FEET", " 42.5 ")).toEqual({ ok: true, hundredths: 4250 });
    expect(parseScoreText("POINTS", "7.05")).toEqual({ ok: true, hundredths: 705 });
    expect(parseScoreText("POINTS", "-3").ok).toBe(false);
    expect(parseScoreText("POINTS", "1.234").ok).toBe(false);
    expect(parseScoreText("POINTS", "").ok).toBe(false);
    expect(parseScoreText("POINTS", "999999").ok).toBe(false);
  });

  it("reads a time as seconds or minutes and seconds", () => {
    expect(parseScoreText("TIME", "45.2")).toEqual({ ok: true, hundredths: 4520 });
    expect(parseScoreText("TIME", "1:02.5")).toEqual({ ok: true, hundredths: 6250 });
    expect(parseScoreText("TIME", "1:75").ok).toBe(false);
    expect(parseScoreText("TIME", "abc").ok).toBe(false);
  });

  it("shows scores in the unit's own form and round-trips through the edit box", () => {
    expect(formatScore("POINTS", 8500)).toBe("85");
    expect(formatScore("POINTS", 8550)).toBe("85.5");
    expect(formatScore("FEET", 4250)).toBe("42.5 ft");
    expect(formatScore("TIME", 6250)).toBe("1:02.5");
    expect(formatScore("TIME", 4520)).toBe("45.2 sec");
    for (const [unit, text] of [["POINTS", "85.5"], ["FEET", "12"], ["TIME", "1:02.5"], ["TIME", "45.2"]] as const) {
      const parsed = parseScoreText(unit, text);
      expect(parsed.ok && scoreInputText(unit, parsed.hundredths)).toBe(text);
    }
  });

  it("writes ordinals correctly", () => {
    expect([1, 2, 3, 4, 11, 12, 21, 22, 103].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "21st", "22nd", "103rd"]);
  });
});

describe("scored event definitions (#1676)", () => {
  const base = { name: "Stilts", kind: "PATHFINDER", unit: "FEET", higherWins: true, ribbonMode: "PLACES", ribbonPlaces: 3, ribbonBands: [] } as const;

  it("accepts a place-ribbon event and rejects unknown fields and more than three places", () => {
    expect(scoredEventInputSchema.safeParse(base).success).toBe(true);
    expect(scoredEventInputSchema.safeParse({ ...base, points: 5 }).success).toBe(false);
    expect(scoredEventInputSchema.safeParse({ ...base, ribbonPlaces: 4 }).success).toBe(false);
  });

  it("needs score bands listed from the best to the lowest, in the event's direction", () => {
    const bands = (list: string[]) => list.map((threshold, index) => ({ label: `Band ${index}`, threshold }));
    expect(buildScoredEventDefinition({ ...base, unit: "POINTS", ribbonMode: "BANDS", ribbonBands: bands(["90", "70"]) }).ok).toBe(true);
    expect(buildScoredEventDefinition({ ...base, unit: "POINTS", ribbonMode: "BANDS", ribbonBands: bands(["70", "90"]) })).toMatchObject({ ok: false, problems: { "ribbonBands.1.threshold": expect.any(String) } });
    expect(buildScoredEventDefinition({ ...base, unit: "TIME", higherWins: false, ribbonMode: "BANDS", ribbonBands: bands(["30", "45"]) }).ok).toBe(true);
    expect(buildScoredEventDefinition({ ...base, ribbonMode: "BANDS", ribbonBands: [] })).toMatchObject({ ok: false });
  });

  it("takes one request shape per action and nothing else", () => {
    expect(eventScoringActionSchema.safeParse({ action: "switch", enabled: true }).success).toBe(true);
    expect(eventScoringActionSchema.safeParse({ action: "publish" }).success).toBe(true);
    expect(eventScoringActionSchema.safeParse({ action: "saveScore", entry: { scoredEventId: "e", subjectId: "s", value: null } }).success).toBe(true);
    expect(eventScoringActionSchema.safeParse({ action: "switch", enabled: true, moduleKey: "merchandise" }).success).toBe(false);
    expect(eventScoringActionSchema.safeParse({ action: "grantPoints" }).success).toBe(false);
  });
});

describe("rankings with ties (#1676)", () => {
  it("lets equal scores share a place and skips the next, higher score wins", () => {
    const ranked = rankEntries([{ subjectId: "a", valueHundredths: 900 }, { subjectId: "b", valueHundredths: 900 }, { subjectId: "c", valueHundredths: 700 }, { subjectId: "d", valueHundredths: 950 }], true);
    expect(ranked.map((entry) => [entry.subjectId, entry.rank, entry.tied])).toEqual([["d", 1, false], ["a", 2, true], ["b", 2, true], ["c", 4, false]]);
  });

  it("ranks the lowest score first when lower wins", () => {
    const ranked = rankEntries([{ subjectId: "a", valueHundredths: 6250 }, { subjectId: "b", valueHundredths: 4520 }, { subjectId: "c", valueHundredths: 4520 }], false);
    expect(ranked.map((entry) => [entry.subjectId, entry.rank, entry.tied])).toEqual([["b", 1, true], ["c", 1, true], ["a", 3, false]]);
  });

  it("gives a ribbon to each tied entry in the ribbon places, and by band for band events", () => {
    expect(ribbonFor(canoe, { rank: 2, valueHundredths: 1 })).toBe("2nd place");
    expect(ribbonFor(canoe, { rank: 3, valueHundredths: 1 })).toBeNull();
    expect(ribbonFor(verse, { rank: 1, valueHundredths: 9500 })).toBe("Blue");
    expect(ribbonFor(verse, { rank: 2, valueHundredths: 7000 })).toBe("Red");
    expect(ribbonFor(verse, { rank: 3, valueHundredths: 6999 })).toBeNull();
  });
});

describe("results, ribbons and award counts (#1676)", () => {
  const scores = [
    { scoredEventId: "e-stilts", subjectId: "p-a1", organizationId: "club-a", valueHundredths: 5000 },
    { scoredEventId: "e-stilts", subjectId: "p-b1", organizationId: "club-b", valueHundredths: 5000 },
    { scoredEventId: "e-stilts", subjectId: "p-c1", organizationId: "club-c", valueHundredths: 2000 },
    { scoredEventId: "e-canoe", subjectId: "club-a", organizationId: "club-a", valueHundredths: 6250 },
    { scoredEventId: "e-canoe", subjectId: "club-b", organizationId: "club-b", valueHundredths: 4520 },
    { scoredEventId: "e-canoe", subjectId: "club-c", organizationId: "club-c", valueHundredths: 7000 },
    { scoredEventId: "e-verse", subjectId: "club-a", organizationId: "club-a", valueHundredths: 9100 },
    { scoredEventId: "e-verse", subjectId: "club-c", organizationId: "club-c", valueHundredths: 6000 },
    // A score for someone no longer registered is left out.
    { scoredEventId: "e-stilts", subjectId: "p-gone", organizationId: "club-a", valueHundredths: 9999 },
  ];
  const results = buildResults([stilts, canoe, verse], scores, { clubs, people });

  it("shows ties in the ranking", () => {
    const stiltsRows = results.events.find((event) => event.id === "e-stilts")!.rows;
    expect(stiltsRows.map((row) => [row.name, row.rank, row.tied])).toEqual([["Ada Sample", 1, true], ["Bea Sample", 1, true], ["Cy Sample", 3, false]]);
    expect(stiltsRows.map((row) => row.scoreText)).toEqual(["50 ft", "50 ft", "20 ft"]);
  });

  it("lists ribbons only for clubs that said yes, and still scores the others", () => {
    const falcons = results.clubs.find((club) => club.organizationId === "club-b")!;
    expect(falcons.wantsRibbons).toBe(false);
    expect(falcons.ribbons).toEqual([]);
    expect(falcons.firsts).toBe(2);
    const stiltsB = results.events.find((event) => event.id === "e-stilts")!.rows.find((row) => row.subjectId === "p-b1")!;
    expect(stiltsB.award).toBe("1st place");
    expect(stiltsB.ribbonWanted).toBe(false);
    const eagles = results.clubs.find((club) => club.organizationId === "club-a")!;
    expect(eagles.ribbons).toEqual([
      { eventName: "Stilts", recipient: "Ada Sample", award: "1st place" },
      { eventName: "Canoe race", recipient: "Eagles", award: "2nd place" },
      { eventName: "Telephone verse", recipient: "Eagles", award: "Blue" },
    ]);
  });

  it("counts trophies for every club and ribbons for the clubs that asked", () => {
    // First places: stilts (Ada and Bea tie), the canoe race (Falcons), the verse (Eagles).
    expect(results.trophies).toBe(4);
    expect(results.ribbonCounts).toEqual([{ award: "1st place", count: 1 }, { award: "2nd place", count: 1 }, { award: "3rd place", count: 1 }, { award: "Blue", count: 1 }]);
    expect(results.ribbonsTotal).toBe(4);
  });

  it("gives a director only their own club's rows, with the place they earned", () => {
    const mine = resultsForClub(results, "club-c");
    expect(mine.events.flatMap((event) => event.rows.map((row) => row.organizationId))).toEqual(["club-c", "club-c", "club-c"]);
    expect(JSON.stringify(mine)).not.toContain("Eagles");
    expect(JSON.stringify(mine)).not.toContain("Ada Sample");
    expect(JSON.stringify(mine)).not.toContain("Bea Sample");
    expect(mine.events.find((event) => event.id === "e-stilts")!.rows[0]).toMatchObject({ rank: 3, name: "Cy Sample" });
    expect(resultsForClub(results, "club-zzz").events).toEqual([]);
  });
});
