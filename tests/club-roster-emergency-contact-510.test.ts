import { describe, expect, it, vi } from "vitest";
import { isMinorRosterPerson } from "@/modules/club-rosters/domain";
import { ROSTER_EXPORT_COLUMNS, isGuardianRosterExportColumn } from "@/modules/club-rosters/export-columns";
import { EMERGENCY_CONTACT_TERM } from "@/modules/club-rosters/guardians-domain";
import { buildRosterExportTable } from "@/modules/club-rosters/export";

/**
 * Emergency contacts for minors only, owner decision Oct 15, 2026 (#510). Synthetic data only.
 */
describe("who is a minor for an emergency contact", () => {
  const today = "2026-10-15";
  it("lets a known birth date decide, with the 18th birthday as the line", () => {
    expect(isMinorRosterPerson("YOUTH", "2008-10-16", today)).toBe(true);
    expect(isMinorRosterPerson("YOUTH", "2008-10-15", today)).toBe(false);
    expect(isMinorRosterPerson("STAFF", "2010-06-01", today)).toBe(true);
    expect(isMinorRosterPerson("ADULT", "1990-06-01", today)).toBe(false);
    expect(isMinorRosterPerson("UNDERAGE", "2023-01-02", today)).toBe(true);
  });
  it("falls back to the age reported on an import, then to the member type", () => {
    expect(isMinorRosterPerson("YOUTH", null, today, 12)).toBe(true);
    expect(isMinorRosterPerson("YOUTH", null, today, 19)).toBe(false);
    expect(isMinorRosterPerson("YOUTH", null, today)).toBe(true);
    expect(isMinorRosterPerson("UNDERAGE", "", today)).toBe(true);
    expect(isMinorRosterPerson("STAFF", null, today)).toBe(false);
    expect(isMinorRosterPerson("ADULT", "not a date", today)).toBe(false);
  });
});

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

describe("the roster API's answer to a contact for an adult", () => {
  it("is a 400 with its own code, not a server error", async () => {
    vi.doMock("server-only", () => ({}));
    const { rosterApiError } = await import("@/modules/club-rosters/api-errors");
    const { RosterOperationError } = await import("@/modules/club-rosters/repository");
    const response = rosterApiError(new RosterOperationError("CONTACT_MINORS_ONLY", "Emergency contacts are only kept for members under 18."), "update");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "CONTACT_MINORS_ONLY" });
  });
});
