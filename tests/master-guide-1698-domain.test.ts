import { describe, expect, it } from "vitest";
import {
  BIRTH_DATE_NEEDED,
  BIRTH_DATE_UNREADABLE,
  addProblem,
  addYears,
  canManageMasterGuide,
  canTransition,
  clubApprovalProblem,
  formatMasterGuideDate,
  isEditable,
  isMasterGuideStatus,
  masterGuideWindow,
} from "@/modules/master-guide/domain";
import { areaApprovalSchema, addCandidateSchema, updateCandidateSchema } from "@/modules/master-guide/schemas";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** Master Guide tracking rules (#1698), pure. Synthetic dates only. */

describe("adding a candidate (16 or older on the start date)", () => {
  it("accepts someone who turns 16 on the start date", () => {
    expect(addProblem("2009-11-12", "2025-11-12")).toBeNull();
  });

  it("refuses someone a day short of 16 on the start date", () => {
    expect(addProblem("2009-11-13", "2025-11-12")).toMatch(/16 or older on the start date/);
  });

  it("judges age on the start date, not today, so a later start can make someone eligible", () => {
    expect(addProblem("2010-03-01", "2026-02-28")).not.toBeNull();
    expect(addProblem("2010-03-01", "2026-03-01")).toBeNull();
  });

  it("says a birth date is needed on the roster when there is none", () => {
    expect(addProblem(null, "2025-11-12")).toBe(BIRTH_DATE_NEEDED);
    expect(BIRTH_DATE_NEEDED).toBe("Birth date needed on the roster.");
  });

  it("refuses a start date that is not a real date", () => {
    expect(addProblem("1990-01-01", "2025-02-30")).toMatch(/real start date/);
  });
});

describe("a birth date that cannot be read", () => {
  it("says so instead of that it is missing, for adding and approving", () => {
    expect(addProblem(BIRTH_DATE_UNREADABLE, "2025-11-12")).toMatch(/could not be read.*conference office/);
    expect(clubApprovalProblem(BIRTH_DATE_UNREADABLE, "2026-11-12")).toMatch(/could not be read/);
  });
});

describe("approval by the club (18 or older on the approval date)", () => {
  it("refuses a candidate who is 17 on the approval date", () => {
    expect(clubApprovalProblem("2008-11-13", "2026-11-12")).toMatch(/18 or older on the approval date/);
  });

  it("accepts a candidate who turns 18 on the approval date", () => {
    expect(clubApprovalProblem("2008-11-12", "2026-11-12")).toBeNull();
  });

  it("needs a birth date on the roster", () => {
    expect(clubApprovalProblem(null, "2026-11-12")).toBe(BIRTH_DATE_NEEDED);
  });

  it("treats a Feb 29 birthday as turning over on Mar 1", () => {
    expect(clubApprovalProblem("2008-02-29", "2026-02-28")).not.toBeNull();
    expect(clubApprovalProblem("2008-02-29", "2026-03-01")).toBeNull();
  });
});

describe("the one to three year window", () => {
  it("adds one and three years to the start date", () => {
    const window = masterGuideWindow("2025-11-01", "2026-11-12");
    expect(window).toMatchObject({ earliestFinish: "2026-11-01", latestFinish: "2028-11-01", pastWindow: false });
  });

  it("moves a Feb 29 start to Mar 1 in a year with no Feb 29", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-03-01");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("flags a candidate still going after the latest finish, on the last day it does not", () => {
    expect(masterGuideWindow("2023-11-01", "2026-11-01")?.pastWindow).toBe(false);
    expect(masterGuideWindow("2023-11-01", "2026-11-02")?.pastWindow).toBe(true);
  });

  it("judges a club-approved candidate on the approval date, not today", () => {
    expect(masterGuideWindow("2020-01-01", "2027-01-01", "2023-01-01")?.pastWindow).toBe(false);
    expect(masterGuideWindow("2020-01-01", "2027-01-01", "2023-01-02")?.pastWindow).toBe(true);
  });

  it("only flags: it never makes the age rules stricter", () => {
    expect(addProblem("1980-01-01", "2010-01-01")).toBeNull();
  });

  it("has no window for a bad date", () => {
    expect(masterGuideWindow("nope", "2026-11-12")).toBeNull();
  });
});

describe("status steps", () => {
  it("allows only the next step, in order", () => {
    expect(canTransition("IN_PROGRESS", "CLUB_APPROVED")).toBe(true);
    expect(canTransition("CLUB_APPROVED", "AREA_APPROVED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "AREA_APPROVED")).toBe(false);
    expect(canTransition("AREA_APPROVED", "CLUB_APPROVED")).toBe(false);
    expect(canTransition("CLUB_APPROVED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("AREA_APPROVED", "AREA_APPROVED")).toBe(false);
  });

  it("edits and removes only while in progress", () => {
    expect(isEditable("IN_PROGRESS")).toBe(true);
    expect(isEditable("CLUB_APPROVED")).toBe(false);
    expect(isEditable("AREA_APPROVED")).toBe(false);
  });

  it("knows only its own statuses", () => {
    expect(isMasterGuideStatus("CLUB_APPROVED")).toBe(true);
    expect(isMasterGuideStatus("CONFERENCE_APPROVED")).toBe(false);
  });
});

describe("who manages the list", () => {
  it("is the director and deputy, not a registrar or reporter", () => {
    expect(canManageMasterGuide(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canManageMasterGuide(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canManageMasterGuide(clubCapabilities("REGISTRAR"))).toBe(false);
    expect(canManageMasterGuide(clubCapabilities("REPORTER"))).toBe(false);
  });
});

describe("input shapes", () => {
  it("trims the mentor and stores a blank one as none", () => {
    expect(addCandidateSchema.parse({ personId: "p1", startedOn: "2026-01-05", mentorName: "  Sam Sample  " }).mentorName).toBe("Sam Sample");
    expect(addCandidateSchema.parse({ personId: "p1", startedOn: "2026-01-05", mentorName: "   " }).mentorName).toBeNull();
  });

  it("refuses a long mentor name, a bad date and unknown fields", () => {
    expect(() => addCandidateSchema.parse({ personId: "p1", startedOn: "2026-01-05", mentorName: "x".repeat(81) })).toThrow();
    expect(() => updateCandidateSchema.parse({ startedOn: "January 5" })).toThrow();
    expect(() => updateCandidateSchema.parse({ startedOn: "2026-01-05", status: "AREA_APPROVED" })).toThrow();
    expect(() => areaApprovalSchema.parse({ candidateId: "c1", status: "AREA_APPROVED" })).toThrow();
  });

  it("formats a calendar date without shifting the day", () => {
    expect(formatMasterGuideDate("2026-11-01")).toBe("Nov 1, 2026");
    expect(formatMasterGuideDate(null)).toBe("");
  });
});

describe("the optional feature", () => {
  it("is on the typed list with a title and an off-by-default description", async () => {
    const { CLUB_OPTIONAL_FEATURE_KEYS, clubOptionalFeatureDefinitions, isClubOptionalFeatureKey } = await import("@/modules/club-features/domain");
    expect(CLUB_OPTIONAL_FEATURE_KEYS).toContain("master-guide-tracking");
    expect(isClubOptionalFeatureKey("master-guide-tracking")).toBe(true);
    expect(clubOptionalFeatureDefinitions["master-guide-tracking"].title).toBe("Master Guide tracking");
  });
});
