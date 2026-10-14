import { describe, expect, it } from "vitest";
import {
  carriedClassLevel,
  carriedRole,
  carryForwardInputSchema,
  carryForwardOversightOpen,
  carryForwardYears,
} from "@/modules/club-rosters/carry-forward-domain";

describe("which club years a carry-forward moves between (#414)", () => {
  it("prepares next year in August, the last month of the club year", () => {
    expect(carryForwardYears(new Date("2027-08-01T00:00:00Z"))).toEqual({ fromClubYear: "2026-27", toClubYear: "2027-28" });
    expect(carryForwardYears(new Date("2027-08-31T23:59:00Z"))).toEqual({ fromClubYear: "2026-27", toClubYear: "2027-28" });
  });

  it("from September a late club carries last year into the current year", () => {
    expect(carryForwardYears(new Date("2027-09-01T00:00:00Z"))).toEqual({ fromClubYear: "2026-27", toClubYear: "2027-28" });
    expect(carryForwardYears(new Date("2027-12-15T12:00:00Z"))).toEqual({ fromClubYear: "2026-27", toClubYear: "2027-28" });
    expect(carryForwardYears(new Date("2028-03-10T12:00:00Z"))).toEqual({ fromClubYear: "2026-27", toClubYear: "2027-28" });
  });

  it("uses the same pair in August and the months after, so a repeat is the same confirmation", () => {
    expect(carryForwardYears(new Date("2027-08-20T00:00:00Z"))).toEqual(carryForwardYears(new Date("2027-09-20T00:00:00Z")));
  });

  it("watches for clubs that have not started only from August through October", () => {
    expect(carryForwardOversightOpen(new Date("2027-07-31T12:00:00Z"))).toBe(false);
    for (const month of ["2027-08-01", "2027-09-15", "2027-10-31"]) {
      expect(carryForwardOversightOpen(new Date(`${month}T12:00:00Z`))).toBe(true);
    }
    expect(carryForwardOversightOpen(new Date("2027-11-01T12:00:00Z"))).toBe(false);
  });
});

describe("a carried person's role and class (#414)", () => {
  it("keeps an untouched role", () => {
    expect(carriedRole({ attendeeType: "STAFF", role: "Counselor" }, { attendeeType: "STAFF" })).toBe("Counselor");
    expect(carriedRole({ attendeeType: "YOUTH", role: "Pathfinder" }, { attendeeType: "YOUTH" })).toBe("Pathfinder");
  });

  it("re-defaults the old type's default role when a Pathfinder becomes staff", () => {
    expect(carriedRole({ attendeeType: "YOUTH", role: "Pathfinder" }, { attendeeType: "STAFF" })).toBe("");
  });

  it("keeps a typed role through a change of type", () => {
    expect(carriedRole({ attendeeType: "YOUTH", role: "Drum major" }, { attendeeType: "STAFF" })).toBe("Drum major");
  });

  it("uses a role the director typed, falling back to the type's default when blank", () => {
    expect(carriedRole({ attendeeType: "YOUTH", role: "Pathfinder" }, { attendeeType: "STAFF", role: "Counselor" })).toBe("Counselor");
    expect(carriedRole({ attendeeType: "STAFF", role: "Counselor" }, { attendeeType: "YOUTH", role: "" })).toBe("Pathfinder");
  });

  it("keeps a class only for youth, and takes a changed one", () => {
    expect(carriedClassLevel({ classLevel: "RANGER" }, { attendeeType: "YOUTH" })).toBe("RANGER");
    expect(carriedClassLevel({ classLevel: "RANGER" }, { attendeeType: "YOUTH", classLevel: "VOYAGER" })).toBe("VOYAGER");
    expect(carriedClassLevel({ classLevel: "RANGER" }, { attendeeType: "YOUTH", classLevel: null })).toBeNull();
    expect(carriedClassLevel({ classLevel: "TLT" }, { attendeeType: "STAFF" })).toBeNull();
  });
});

describe("the carry-forward request (#414)", () => {
  const person = { memberId: "m1", attendeeType: "YOUTH" as const };

  it("needs the director's confirmation and at least one person", () => {
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [person] }).success).toBe(true);
    expect(carryForwardInputSchema.safeParse({ people: [person] }).success).toBe(false);
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [] }).success).toBe(false);
  });

  it("refuses a person listed twice, an unknown type, and any extra field such as a birth date", () => {
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [person, person] }).success).toBe(false);
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [{ ...person, attendeeType: "VISITOR" }] }).success).toBe(false);
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [{ ...person, birthDate: "2012-01-01" }] }).success).toBe(false);
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [person], clubYear: "2030-31" }).success).toBe(false);
  });
});
