import { describe, expect, it } from "vitest";
import { contactsRosterYear, guardianEditableYears } from "@/modules/club-rosters/domain";

describe("which years allow emergency contact edits (#959)", () => {
  const lastAugust = new Date("2026-08-31T23:59:59Z");
  const firstSeptember = new Date("2026-09-01T00:00:00Z");

  it("is current and next, and rolls over exactly at September 1 UTC", () => {
    expect(guardianEditableYears(lastAugust)).toEqual(["2025-26", "2026-27"]);
    expect(guardianEditableYears(firstSeptember)).toEqual(["2026-27", "2027-28"]);
  });

  it("answers for next year only when named, at both sides of the boundary", () => {
    expect(contactsRosterYear("2026-27", lastAugust)).toBe("2026-27");
    expect(contactsRosterYear("2025-26", lastAugust)).toBe("2025-26");
    expect(contactsRosterYear("2027-28", firstSeptember)).toBe("2027-28");
    expect(contactsRosterYear("2026-27", firstSeptember)).toBe("2026-27");
  });

  it("falls back to the current year for a past year, two years out, junk and null", () => {
    expect(contactsRosterYear("2024-25", lastAugust)).toBe("2025-26");
    expect(contactsRosterYear("2025-26", firstSeptember)).toBe("2026-27");
    expect(contactsRosterYear("2028-29", firstSeptember)).toBe("2026-27");
    expect(contactsRosterYear("2027-28", lastAugust)).toBe("2025-26");
    expect(contactsRosterYear("junk", firstSeptember)).toBe("2026-27");
    expect(contactsRosterYear("", firstSeptember)).toBe("2026-27");
    expect(contactsRosterYear(null, firstSeptember)).toBe("2026-27");
    expect(contactsRosterYear(undefined, firstSeptember)).toBe("2026-27");
  });
});
