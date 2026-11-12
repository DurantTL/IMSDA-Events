import { describe, expect, it } from "vitest";
import { CLUB_KINDS, clubKindLabel, clubMemberNoun, clubMemberNounPlural, normalizeClubKind, parseClubKindFilter } from "@/modules/organizations/club-kind";
import { carriedRole } from "@/modules/club-rosters/carry-forward-domain";
import { rosterCsvAddDefaults } from "@/modules/club-rosters/csv-import";
import { defaultRosterRole, displayRosterRole, isDefaultYouthRole, rosterRoleOrDefault } from "@/modules/club-rosters/domain";

describe("club kind wording (#1517)", () => {
  it("labels and names each kind", () => {
    expect(CLUB_KINDS).toEqual(["PATHFINDER", "ADVENTURER"]);
    expect(clubKindLabel("PATHFINDER")).toBe("Pathfinder club");
    expect(clubKindLabel("ADVENTURER")).toBe("Adventurer club");
    expect(clubMemberNoun("ADVENTURER")).toBe("Adventurer");
    expect(clubMemberNounPlural("ADVENTURER")).toBe("Adventurers");
  });

  it("reads anything else as a Pathfinder club, exactly as before", () => {
    for (const value of [undefined, null, "", "pathfinder", "OTHER"]) {
      expect(normalizeClubKind(value)).toBe("PATHFINDER");
      expect(clubMemberNoun(value)).toBe("Pathfinder");
      expect(clubMemberNounPlural(value)).toBe("Pathfinders");
    }
  });

  it("parses the orders filter, where a missing, repeated or invalid value means All", () => {
    expect(parseClubKindFilter("adventurer")).toBe("ADVENTURER");
    expect(parseClubKindFilter(" Pathfinder ")).toBe("PATHFINDER");
    expect(parseClubKindFilter("ADVENTURER")).toBe("ADVENTURER");
    expect(parseClubKindFilter(undefined)).toBeNull();
    expect(parseClubKindFilter("")).toBeNull();
    expect(parseClubKindFilter("all")).toBeNull();
    expect(parseClubKindFilter(["adventurer", "pathfinder"])).toBeNull();
  });

  it("defaults a youth role by kind and leaves staff and adults blank", () => {
    expect(defaultRosterRole("YOUTH")).toBe("Pathfinder");
    expect(defaultRosterRole("YOUTH", "PATHFINDER")).toBe("Pathfinder");
    expect(defaultRosterRole("YOUTH", "ADVENTURER")).toBe("Adventurer");
    expect(defaultRosterRole("ADULT", "ADVENTURER")).toBe("");
    expect(rosterRoleOrDefault("  ", "YOUTH", "ADVENTURER")).toBe("Adventurer");
    expect(rosterRoleOrDefault("TLT", "YOUTH", "ADVENTURER")).toBe("TLT");
    expect(isDefaultYouthRole("Adventurer")).toBe(true);
    expect(isDefaultYouthRole("Pathfinder")).toBe(true);
    expect(isDefaultYouthRole("TLT")).toBe(false);
  });
});

describe("role wording by club kind (#1517)", () => {
  it("shows a stored default youth role as the club's noun, and never changes a typed role", () => {
    expect(displayRosterRole("Pathfinder", "ADVENTURER")).toBe("Adventurer");
    expect(displayRosterRole("Adventurer", "PATHFINDER")).toBe("Pathfinder");
    expect(displayRosterRole("Pathfinder")).toBe("Pathfinder");
    expect(displayRosterRole("TLT", "ADVENTURER")).toBe("TLT");
    expect(displayRosterRole(null, "ADVENTURER")).toBe("");
  });

  it("carries a blank youth role as the club's default and re-defaults it when a youth becomes staff", () => {
    expect(carriedRole({ attendeeType: "YOUTH", role: "" }, { attendeeType: "YOUTH", role: "" }, "ADVENTURER")).toBe("Adventurer");
    expect(carriedRole({ attendeeType: "YOUTH", role: "Pathfinder" }, { attendeeType: "STAFF" }, "ADVENTURER")).toBe("");
    expect(carriedRole({ attendeeType: "YOUTH", role: "Adventurer" }, { attendeeType: "ADULT" }, "ADVENTURER")).toBe("");
    expect(carriedRole({ attendeeType: "YOUTH", role: "TLT" }, { attendeeType: "STAFF" }, "ADVENTURER")).toBe("TLT");
  });

  it("defaults a blank CSV youth role by club kind", () => {
    const row = { line: 2, firstName: "A", lastName: "B" } as Parameters<typeof rosterCsvAddDefaults>[0];
    expect(rosterCsvAddDefaults(row, "ADVENTURER")).toEqual({ attendeeType: "YOUTH", role: "Adventurer" });
    expect(rosterCsvAddDefaults(row)).toEqual({ attendeeType: "YOUTH", role: "Pathfinder" });
  });
});
