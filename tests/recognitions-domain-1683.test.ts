import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { creationModuleKeys, defaultModuleKeys, eventModuleDefinition, scopedToggleModuleKeys } from "@/modules/event-modules/catalog";
import { clubLabel, describeItemCounts, markInputSchema, recognitionInputSchema, summarizeRecognitions, type RecognitionDefinition, type RecognitionMark } from "@/modules/recognitions/domain";

const verses: RecognitionDefinition = { id: "t-verse", name: "Memory verses", item: "PIN", isActive: true };
const bible: RecognitionDefinition = { id: "t-bible", name: "Read the Bible through", item: "PATCH", isActive: true };
const again: RecognitionDefinition = { id: "t-again", name: "Read the Bible through (again)", item: "STAR", isActive: true };
const definitions = [verses, bible, again];

const mark = (recognitionId: string, attendeeId: string, attendeeName: string, clubKey: string, clubName: string): RecognitionMark => ({ recognitionId, attendeeId, attendeeName, clubKey, clubName });

describe("Recognitions module (#1683)", () => {
  it("is an optional, off-by-default club module, switched by the scoped helper (staff side only in this slice)", () => {
    expect(eventModuleDefinition("recognitions")).toMatchObject({ title: "Recognitions", appliesTo: "club-audience", offByDefault: true, alwaysOn: false, cardKey: "recognitions", routes: ["/more/recognitions"] });
    expect(defaultModuleKeys("CLUB")).not.toContain("recognitions");
    expect(defaultModuleKeys("GENERAL")).not.toContain("recognitions");
    expect(creationModuleKeys("CLUB")).not.toContain("recognitions");
    expect(scopedToggleModuleKeys).toContain("recognitions");
  });

  it("adds one nullable column and an enum, and writes no module row", () => {
    const sql = readFileSync("prisma/migrations/20270153100000_event_recognitions/migration.sql", "utf8").replace(/^--.*$/gm, "");
    expect(sql).toContain(`CREATE TYPE "RecognitionItem" AS ENUM ('PIN', 'PATCH', 'STAR')`);
    expect(sql).toContain(`ADD COLUMN "recognitionItem" "RecognitionItem"`);
    expect(sql).not.toMatch(/NOT NULL|INSERT|EventModule/);
  });
});

describe("summarizeRecognitions", () => {
  const marks = [
    mark(verses.id, "a1", "Alex Sample", "org1|", "Eagle Pathfinders"),
    mark(bible.id, "a1", "Alex Sample", "org1|", "Eagle Pathfinders"),
    mark(verses.id, "a2", "Blake Sample", "org1|", "Eagle Pathfinders"),
    mark(again.id, "a3", "Casey Sample", "org2|", "Bear Adventurers"),
    mark(verses.id, "a3", "Casey Sample", "org2|", "Bear Adventurers"),
  ];

  it("counts per recognition, per item and per club", () => {
    const result = summarizeRecognitions(definitions, marks);
    expect(result.perRecognition.map((row) => [row.name, row.count])).toEqual([["Memory verses", 3], ["Read the Bible through", 1], ["Read the Bible through (again)", 1]]);
    expect(result.perItem).toEqual({ PIN: 3, PATCH: 1, STAR: 1 });
    expect(result.perClub).toEqual([
      { clubKey: "org2|", clubName: "Bear Adventurers", counts: { PIN: 1, PATCH: 0, STAR: 1 }, total: 2 },
      { clubKey: "org1|", clubName: "Eagle Pathfinders", counts: { PIN: 2, PATCH: 1, STAR: 0 }, total: 3 },
    ]);
  });

  it("builds a hand-out list per club, names sorted, with what each person earned", () => {
    const { handOut } = summarizeRecognitions(definitions, marks);
    expect(handOut.map((club) => club.clubName)).toEqual(["Bear Adventurers", "Eagle Pathfinders"]);
    expect(handOut[1].people).toEqual([
      { attendeeId: "a1", name: "Alex Sample", earned: ["Memory verses", "Read the Bible through"] },
      { attendeeId: "a2", name: "Blake Sample", earned: ["Memory verses"] },
    ]);
    expect(handOut[0].people).toEqual([{ attendeeId: "a3", name: "Casey Sample", earned: ["Memory verses", "Read the Bible through (again)"] }]);
  });

  it("counts a repeated mark once, and ignores a mark for a recognition not listed", () => {
    const result = summarizeRecognitions(definitions, [...marks, marks[0], mark("unknown", "a9", "Dana Sample", "org1|", "Eagle Pathfinders")]);
    expect(result.perItem).toEqual({ PIN: 3, PATCH: 1, STAR: 1 });
    expect(JSON.stringify(result)).not.toContain("Dana Sample");
  });

  it("shows zero for a recognition nobody has earned and an empty list with no marks", () => {
    const result = summarizeRecognitions(definitions, []);
    expect(result.perRecognition.every((row) => row.count === 0)).toBe(true);
    expect(result.perClub).toEqual([]);
    expect(result.handOut).toEqual([]);
    expect(describeItemCounts(result.perItem)).toBe("Nothing marked yet");
  });

  it("describes counts in plain words", () => {
    expect(describeItemCounts({ PIN: 1, PATCH: 2, STAR: 0 })).toBe("1 pin, 2 patches");
  });

  it("labels a named team with its club", () => {
    expect(clubLabel("Eagle Pathfinders", "Blue team")).toBe("Eagle Pathfinders (Blue team)");
    expect(clubLabel("Eagle Pathfinders", null)).toBe("Eagle Pathfinders");
    expect(clubLabel("Eagle Pathfinders", "  ")).toBe("Eagle Pathfinders");
  });
});

describe("input schemas", () => {
  it("accepts a name and what it earns, and rejects anything else", () => {
    expect(recognitionInputSchema.parse({ name: " Memory verses ", item: "PIN" })).toEqual({ name: "Memory verses", item: "PIN" });
    expect(() => recognitionInputSchema.parse({ name: "M", item: "PIN" })).toThrow();
    expect(() => recognitionInputSchema.parse({ name: "Memory verses", item: "TROPHY" })).toThrow();
    expect(() => markInputSchema.parse({ attendeeId: "", recognitionId: "x" })).toThrow();
  });
});
