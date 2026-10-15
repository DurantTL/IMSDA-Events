import { describe, expect, it } from "vitest";
import { ROSTER_EXPORT_COLUMNS, isGuardianRosterExportColumn } from "@/modules/club-rosters/export-columns";
import { EMERGENCY_CONTACT_TERM } from "@/modules/club-rosters/guardians-domain";
import { buildRosterExportTable } from "@/modules/club-rosters/export";

/**
 * Emergency contacts for every roster member, labelled "Emergency contact" everywhere (#510). Synthetic data only.
 */
describe("staff-facing wording", () => {
  it("says Emergency contact, never Guardian, on screen and in the export headers", () => {
    expect(EMERGENCY_CONTACT_TERM.singular).toBe("Emergency contact");
    const guardianHeaders = Object.entries(ROSTER_EXPORT_COLUMNS)
      .filter(([key]) => isGuardianRosterExportColumn(key as keyof typeof ROSTER_EXPORT_COLUMNS))
      .map(([, definition]) => definition.header);
    expect(guardianHeaders).toHaveLength(8);
    for (const header of guardianHeaders) {
      expect(header).toMatch(/^Emergency contact [12] (name|relationship|email|phone)$/);
    }
  });
  it("keeps the column keys, so a saved export format still opens", () => {
    expect(Object.keys(ROSTER_EXPORT_COLUMNS)).toEqual(expect.arrayContaining(["guardian1Name", "guardian2Phone"]));
  });
});

describe("the export cells", () => {
  it("leaves emergency contact cells empty for a member with none", () => {
    const member = { id: "m1", firstName: "Ana", lastName: "Reyes", attendeeType: "STAFF" as const, role: "", classLevel: null, gender: null, status: "ACTIVE" as const, source: "DIRECTOR" as const, age: 40, reportedAge: null, birthDateNeeded: false, updatedAt: "2026-10-15T00:00:00.000Z" };
    const table = buildRosterExportTable([member], [{ key: "guardian1Name", header: "Emergency contact 1 name" }], null, {});
    expect(table.rows).toEqual([[""]]);
  });
});
