import { describe, expect, it, vi } from "vitest";
import { buildEmergencyPlanSnapshot, emergencyPlanDraftSchema, snapshotAllowedKeys } from "@/modules/emergency-plans/domain";
import { buildEmergencyReferenceSheet, draftBanner, emergencyReferenceCsv, emergencyReferenceCsvHeader, emergencyReferenceFooter } from "@/modules/reporting/emergency-reference";

/** The emergency reference sheet and its CSV (#114): pure functions of a snapshot. Synthetic data only. */

const snapshot = buildEmergencyPlanSnapshot(emergencyPlanDraftSchema.parse({
  locations: [
    { kind: "ASSEMBLY", name: "Main field", description: "Open lawn", capacityNote: "400", directions: "North door", mapReference: "Grid C4" },
    { kind: "SHELTER", name: "Gym", description: "", capacityNote: "250", directions: "", mapReference: null },
  ],
  procedures: [{ kind: "SEVERE_WEATHER", title: "Tornado warning", body: "Go to the gym.", items: [{ title: "Move", text: "Walk, do not run." }] }],
  contacts: [{ role: "Director", name: "=Sample Director", phone: "(515) 555-0100", escalationOrder: 1 }],
}), { name: "Synthetic Camp Meeting", startsAt: new Date("2026-07-15T14:00:00Z"), endsAt: new Date("2026-07-19T20:00:00Z"), timezone: "America/Chicago" });

const published = { versionNumber: 3, publishedAt: new Date("2026-07-01T15:30:00Z") };

describe("emergency reference sheet", () => {
  it("splits assembly locations from shelters and keeps escalation order", () => {
    const sheet = buildEmergencyReferenceSheet(snapshot, published);
    expect(sheet.assemblyLocations.map((row) => row.name)).toEqual(["Main field"]);
    expect(sheet.shelters.map((row) => row.name)).toEqual(["Gym"]);
    expect(sheet.contacts[0].escalationOrder).toBe(1);
    expect(sheet.isDraft).toBe(false);
    expect(sheet.banner).toBeNull();
  });

  it("identifies the version, published date and print time in the footer", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T18:05:00Z"));
    try {
      const footer = emergencyReferenceFooter(buildEmergencyReferenceSheet(snapshot, published), new Date());
      expect(footer).toContain("Version 3");
      expect(footer).toContain("Published Wed, Jul 1, 2026, 10:30 AM CDT");
      expect(footer).toContain("Printed Thu, Jul 16, 2026, 1:05 PM CDT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a draft preview and makes no version claim", () => {
    const sheet = buildEmergencyReferenceSheet(snapshot, null);
    expect(sheet.isDraft).toBe(true);
    expect(sheet.banner).toBe(draftBanner);
    expect(sheet.versionNumber).toBeNull();
    const footer = emergencyReferenceFooter(sheet, new Date("2026-07-16T18:05:00Z"));
    expect(footer).toContain("DRAFT — not published");
    expect(footer).not.toMatch(/Version|Published/);
  });
});

describe("emergency reference CSV", () => {
  it("has the fixed header, the version row, and guards spreadsheet formulas", () => {
    const csv = emergencyReferenceCsv(buildEmergencyReferenceSheet(snapshot, published));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(emergencyReferenceCsvHeader.map((name) => `"${name}"`).join(","));
    expect(csv).toContain('"Version","3","Version 3"');
    expect(csv).toContain('"\'=Sample Director"');
    expect(csv).toContain("(515) 555-0100");
    expect(csv).toContain("1. Move: Walk, do not run.");
  });

  it("carries only text from the snapshot allowlist", () => {
    expect(Object.keys(snapshot.contacts[0]).sort()).toEqual([...snapshotAllowedKeys.contact].sort());
    const csv = emergencyReferenceCsv(buildEmergencyReferenceSheet(snapshot, published));
    expect(csv).not.toMatch(/attendee|guardian|medical|custody|incident|allerg/i);
  });
});
