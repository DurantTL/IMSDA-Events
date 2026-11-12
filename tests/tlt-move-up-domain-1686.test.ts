import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { isMoveUpEligible, moveUpResultMessage, moveUpSchema, planTltMoveUp, type TltMoveUpRow } from "@/modules/tlt-directory/domain";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const row = (overrides: Partial<TltMoveUpRow>): TltMoveUpRow => ({
  personId: "p1", name: "Casey Sample", clubName: "Test Pathfinders", tltYear: 2, tltYearClubYear: "2025-26", status: "ACTIVE", ...overrides,
});

describe("who is offered a move up (#1686)", () => {
  const clubYear = () => clubYearFor(new Date());

  it("uses the pinned club year", () => expect(clubYear()).toBe("2026-27"));

  it.each([1, 2, 3])("proposes Year %i set in an earlier club year", (year) => {
    expect(isMoveUpEligible({ tltYear: year, tltYearClubYear: "2025-26", status: "ACTIVE" }, clubYear())).toBe(true);
  });

  it("proposes a year with no club year recorded, and a TLT with no status", () => {
    expect(isMoveUpEligible({ tltYear: 1, tltYearClubYear: null, status: null }, clubYear())).toBe(true);
  });

  it("does not propose Year 4, no year, finished, left, or a year already set for this club year", () => {
    expect(isMoveUpEligible({ tltYear: 4, tltYearClubYear: "2025-26", status: "ACTIVE" }, clubYear())).toBe(false);
    expect(isMoveUpEligible({ tltYear: null, tltYearClubYear: null, status: "ACTIVE" }, clubYear())).toBe(false);
    expect(isMoveUpEligible({ tltYear: 2, tltYearClubYear: "2025-26", status: "FINISHED" }, clubYear())).toBe(false);
    expect(isMoveUpEligible({ tltYear: 2, tltYearClubYear: "2025-26", status: "LEFT" }, clubYear())).toBe(false);
    expect(isMoveUpEligible({ tltYear: 2, tltYearClubYear: "2026-27", status: "ACTIVE" }, clubYear())).toBe(false);
    expect(isMoveUpEligible({ tltYear: 2, tltYearClubYear: "2027-28", status: "ACTIVE" }, clubYear())).toBe(false);
  });

  it("rolls over in September: the same TLT is not offered in August, is offered from September", () => {
    vi.setSystemTime(new Date("2027-08-31T12:00:00Z"));
    expect(isMoveUpEligible({ tltYear: 2, tltYearClubYear: "2026-27", status: "ACTIVE" }, clubYearFor(new Date()))).toBe(false);
    vi.setSystemTime(new Date("2027-09-01T12:00:00Z"));
    expect(isMoveUpEligible({ tltYear: 2, tltYearClubYear: "2026-27", status: "ACTIVE" }, clubYearFor(new Date()))).toBe(true);
  });
});

describe("the move-up plan (#1686)", () => {
  it("groups the proposed moves, the last level, the unset and the already-done count", () => {
    const plan = planTltMoveUp([
      row({ personId: "b", name: "Bea Example", tltYear: 3 }),
      row({ personId: "a", name: "Avi Example", tltYear: 1, tltYearClubYear: null }),
      row({ personId: "c", name: "Cy Example", tltYear: 4 }),
      row({ personId: "d", name: "Di Example", tltYear: null, tltYearClubYear: null, status: null }),
      row({ personId: "e", name: "Eli Example", tltYear: 2, tltYearClubYear: "2026-27" }),
      row({ personId: "f", name: "Fay Example", tltYear: 2, status: "FINISHED" }),
      row({ personId: "g", name: "Gus Example", tltYear: 4, status: "LEFT" }),
    ], "2026-27");
    expect(plan.proposed).toEqual([
      { personId: "a", name: "Avi Example", clubName: "Test Pathfinders", fromYear: 1, toYear: 2 },
      { personId: "b", name: "Bea Example", clubName: "Test Pathfinders", fromYear: 3, toYear: 4 },
    ]);
    expect(plan.lastLevel.map((r) => r.personId)).toEqual(["c"]);
    expect(plan.notSet.map((r) => r.personId)).toEqual(["d"]);
    expect(plan.alreadyThisYear).toBe(1);
  });

  it("proposes nobody for an empty directory", () => {
    expect(planTltMoveUp([], "2026-27")).toMatchObject({ proposed: [], lastLevel: [], notSet: [], alreadyThisYear: 0 });
  });
});

describe("the move-up request and message (#1686)", () => {
  it("accepts a club year and ids only, and removes duplicates", () => {
    expect(moveUpSchema.parse({ clubYear: "2026-27", personIds: ["p1", "p1", "p2"] })).toEqual({ clubYear: "2026-27", personIds: ["p1", "p2"] });
    expect(() => moveUpSchema.parse({ clubYear: "2026-27", personIds: [] })).toThrow();
    expect(() => moveUpSchema.parse({ clubYear: "next", personIds: ["p1"] })).toThrow();
    expect(() => moveUpSchema.parse({ clubYear: "2026-27", personIds: ["p1"], tltYear: 4 })).toThrow();
  });

  it("words the result", () => {
    expect(moveUpResultMessage(5, 1)).toBe("Moved 5 TLTs up a year. 1 was skipped because it had already changed.");
    expect(moveUpResultMessage(1, 0)).toBe("Moved 1 TLT up a year.");
    expect(moveUpResultMessage(0, 2)).toBe("Moved 0 TLTs up a year. 2 were skipped because they had already changed.");
  });
});
