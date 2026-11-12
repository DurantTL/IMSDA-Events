import { describe, expect, it } from "vitest";
import {
  ALL_CLUB_KINDS,
  areaClubWhere,
  grantMinistries,
  ministriesIncludeKind,
  ministriesLabel,
  normalizeMinistries,
  parseMinistriesInput,
} from "@/modules/organizations/area-coordinator-ministries-domain";

describe("Area Coordinator ministries (#843)", () => {
  it("normalises to known kinds, once each, in a fixed order", () => {
    expect(normalizeMinistries(["ADVENTURER", "PATHFINDER", "ADVENTURER", "OTHER"])).toEqual(["PATHFINDER", "ADVENTURER"]);
    expect(normalizeMinistries(null)).toEqual([]);
  });

  it("reads a grant with no usable list as a Pathfinder coordinator", () => {
    expect(grantMinistries([])).toEqual(["PATHFINDER"]);
    expect(grantMinistries(undefined)).toEqual(["PATHFINDER"]);
    expect(grantMinistries(["ADVENTURER"])).toEqual(["ADVENTURER"]);
  });

  it("accepts an admin's list only when it holds at least one known, distinct ministry", () => {
    expect(parseMinistriesInput(["ADVENTURER", "PATHFINDER"])).toEqual(["PATHFINDER", "ADVENTURER"]);
    expect(parseMinistriesInput([])).toBeNull();
    expect(parseMinistriesInput(["PATHFINDER", "PATHFINDER"])).toBeNull();
    expect(parseMinistriesInput(["PATHFINDER", "DISTRICT"])).toBeNull();
    expect(parseMinistriesInput("PATHFINDER")).toBeNull();
  });

  it("labels the ministries in words", () => {
    expect(ministriesLabel(["PATHFINDER"])).toBe("Pathfinder");
    expect(ministriesLabel(["ADVENTURER", "PATHFINDER"])).toBe("Pathfinder and Adventurer");
  });

  it("builds the active-club filter from the ministries", () => {
    expect(areaClubWhere(["ADVENTURER"])).toEqual({ type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["ADVENTURER"] } });
    expect(areaClubWhere(ALL_CLUB_KINDS).clubKind).toEqual({ in: ["PATHFINDER", "ADVENTURER"] });
  });

  it("matches a kind against the ministries, and never a missing kind", () => {
    expect(ministriesIncludeKind(["PATHFINDER"], "PATHFINDER")).toBe(true);
    expect(ministriesIncludeKind(["PATHFINDER"], "ADVENTURER")).toBe(false);
    expect(ministriesIncludeKind(["PATHFINDER"], null)).toBe(false);
  });
});
