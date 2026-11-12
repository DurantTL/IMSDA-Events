import { describe, expect, it } from "vitest";
import { importStatuses, inspectionActionSchema, inspectionImportSchema, normalizeClubName, readInspectionKey } from "@/modules/event-inspections/domain";
import { InspectionImportError, matchedRows, planInspectionImport, type RegisteredClub } from "@/modules/event-inspections/import-plan";
import { parseScoreText } from "@/modules/event-scoring/domain";

const clubs: RegisteredClub[] = [
  { organizationId: "club-eagles", name: "Sample Eagles", orgCode: "EAG-01" },
  { organizationId: "club-falcons", name: "Sample Falcons", orgCode: null },
  { organizationId: "club-twin-a", name: "Twin Hawks", orgCode: "TWA" },
  { organizationId: "club-twin-b", name: "twin  hawks", orgCode: "TWB" },
];
const plan = (csv: string) => planInspectionImport(csv, clubs);

describe("reading names and words", () => {
  it("compares club names without case, spacing, accents or punctuation", () => {
    expect(normalizeClubName("  Sample   EAGLES ")).toBe("sample eagles");
    expect(normalizeClubName("Café-Club, Inc.")).toBe("cafe club inc");
  });
  it("reads an inspection word, and nothing else", () => {
    expect(readInspectionKey(" Campsite ")).toBe("campsite");
    expect(readInspectionKey("UNIFORM inspection")).toBe("uniform");
    expect(readInspectionKey("kitchen")).toBeNull();
    expect(readInspectionKey("")).toBeNull();
  });
});

describe("score validation for an inspection (points, up to two decimals)", () => {
  it.each([["85", 8500], ["92.5", 9250], ["0", 0], ["100.25", 10025]])("reads %s", (text, hundredths) => {
    expect(parseScoreText("POINTS", text)).toEqual({ ok: true, hundredths });
  });
  it.each(["", "abc", "-5", "1.234", "1e3", "12,5", "9999999"])("refuses %j", (text) => {
    expect(parseScoreText("POINTS", text).ok).toBe(false);
  });
});

describe("planning an import", () => {
  it("matches by name or by id or code, then validates the inspection and the score", () => {
    const preview = plan([
      "club,inspection,score",
      "sample eagles,Campsite,88",
      "SAMPLE FALCONS,uniform inspection,91.5",
      "Nobody Here,campsite,70",
      "Sample Eagles,kitchen,70",
      "Sample Falcons,campsite,lots",
      "Twin Hawks,campsite,60",
    ].join("\n"));
    expect(preview.rows.map((row) => row.status)).toEqual(["matched", "matched", "unknown_club", "bad_inspection", "bad_score", "ambiguous_club"]);
    expect(preview.counts).toMatchObject({ matched: 2, unknown_club: 1, bad_inspection: 1, bad_score: 1, ambiguous_club: 1 });
    expect(matchedRows(preview).map((row) => [row.organizationId, row.inspection, row.hundredths])).toEqual([["club-eagles", "campsite", 8800], ["club-falcons", "uniform", 9150]]);
    expect(preview.rows[2].message).toBeTruthy();
  });

  it("picks the exact club by id or code, which also settles two clubs with the same name", () => {
    const preview = plan("Club,Club Code,Inspection,Score\nTwin Hawks,TWB,uniform,70\n,club-eagles,campsite,80\nSample Eagles,NOPE,campsite,80");
    expect(preview.rows.map((row) => row.status)).toEqual(["matched", "matched", "unknown_club"]);
    expect(preview.rows[0].organizationId).toBe("club-twin-b");
    expect(preview.rows[1].organizationId).toBe("club-eagles");
  });

  it("marks every row of a repeated club and inspection as a duplicate and applies none of them", () => {
    const preview = plan("club,inspection,score\nSample Eagles,campsite,80\nSample Falcons,campsite,70\nsample eagles,Campsite,81\nSample Eagles,uniform,90");
    expect(preview.rows.map((row) => row.status)).toEqual(["duplicate", "matched", "duplicate", "matched"]);
    expect(preview.rows[0].message).toContain("lines 2, 4");
  });

  it("handles quoted cells, a byte order mark, blank lines and Windows line endings", () => {
    const preview = plan('﻿club,inspection,score\r\n"Sample Eagles",campsite,"88.5"\r\n\r\n');
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ status: "matched", hundredths: 8850, line: 2 });
  });

  it("explains an unusable file in plain words", () => {
    expect(() => plan("")).toThrow(InspectionImportError);
    expect(() => plan("name,rating\nSample Eagles,5")).toThrow("club, inspection and score");
    expect(() => plan("club,inspection,score")).toThrow("no rows");
    expect(() => plan('club,inspection,score\n"open,campsite,5')).toThrow(InspectionImportError);
  });

  it("gives a digest that changes with the file and the clubs, so an apply must be for the previewed file", () => {
    const csv = "club,inspection,score\nSample Eagles,campsite,80";
    const same = plan(csv).digest;
    expect(plan(csv).digest).toBe(same);
    expect(plan(csv.replace("80", "81")).digest).not.toBe(same);
    expect(planInspectionImport(csv, clubs.map((club) => (club.name === "Sample Eagles" ? { ...club, organizationId: "club-other" } : club))).digest).not.toBe(same);
    expect(same).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks each matched row as new, changed or the same as the score on file", () => {
    const existing = new Map([["club-eagles|campsite", 8800], ["club-falcons|uniform", 9000]]);
    const preview = planInspectionImport("club,inspection,score\nSample Eagles,campsite,88\nSample Falcons,uniform,91\nSample Eagles,uniform,70\nNobody,uniform,1", clubs, existing);
    expect(preview.rows.map((row) => [row.change, row.existingText])).toEqual([["same", "88"], ["changed", "90"], ["new", null], [null, null]]);
    expect(planInspectionImport("club,inspection,score\nSample Eagles,campsite,88", clubs, new Map([["club-eagles|campsite", 1]])).digest).not.toBe(planInspectionImport("club,inspection,score\nSample Eagles,campsite,88", clubs).digest);
  });

  it("counts every status", () => {
    expect(Object.keys(plan("club,inspection,score\nSample Eagles,campsite,80").counts).sort()).toEqual([...importStatuses].sort());
  });
});

describe("request shapes", () => {
  it("accepts the two actions and nothing extra", () => {
    expect(inspectionActionSchema.safeParse({ action: "switch", enabled: true }).success).toBe(true);
    expect(inspectionActionSchema.safeParse({ action: "saveScore", entry: { inspection: "uniform", subjectId: "c1", value: null, expected: "" } }).success).toBe(true);
    expect(inspectionActionSchema.safeParse({ action: "saveScore", entry: { inspection: "uniform", subjectId: "c1", value: "5" } }).success).toBe(false);
    expect(inspectionActionSchema.safeParse({ action: "saveScore", entry: { inspection: "kitchen", subjectId: "c1", value: "5", expected: "" } }).success).toBe(false);
    expect(inspectionActionSchema.safeParse({ action: "publish" }).success).toBe(false);
    expect(inspectionActionSchema.safeParse({ action: "switch", enabled: true, moduleKey: "merchandise" }).success).toBe(false);
  });
  it("needs the preview's digest to apply", () => {
    expect(inspectionImportSchema.safeParse({ action: "apply", csv: "x" }).success).toBe(false);
    expect(inspectionImportSchema.safeParse({ action: "apply", csv: "x", digest: "0".repeat(64) }).success).toBe(true);
    expect(inspectionImportSchema.safeParse({ action: "preview", csv: "x".repeat(200_001) }).success).toBe(false);
  });
});
