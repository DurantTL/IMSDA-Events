import { describe, expect, it } from "vitest";
import { clubYearStartYear, groupClubFormsByYear, isEarlierClubYear, showStartNewYear } from "@/modules/club-forms/past-years-domain";

/** #1323: past club years on the director's Forms page. Synthetic data only. */
const link = (id: string, clubYear: string) => ({ id, clubYear });
const form = (id: string, clubYear: string, rosterMemberId: string | null = null) => ({ id, clubYear, rosterMemberId });

describe("club year comparison", () => {
  it("reads the first year and compares club years, not strings", () => {
    expect(clubYearStartYear("2026-27")).toBe(2026);
    expect(clubYearStartYear("garbage")).toBeNull();
    expect(isEarlierClubYear("2025-26", "2026-27")).toBe(true);
    expect(isEarlierClubYear("2026-27", "2026-27")).toBe(false);
    expect(isEarlierClubYear("2027-28", "2026-27")).toBe(false);
    expect(isEarlierClubYear(undefined, "2026-27")).toBe(false);
    expect(isEarlierClubYear("2099-00", "2100-01")).toBe(true);
  });
});

describe("grouping by club year", () => {
  const links = [link("l1", "2026-27"), link("l2", "2025-26"), link("l3", "2024-25"), link("l4", "2025-26")];
  const submissions = [form("s1", "2026-27"), form("s2", "2024-25"), form("s3", "2025-26")];

  it("keeps everything in the current lists before the club starts the new year", () => {
    const result = groupClubFormsByYear({ links, submissions, startedClubYear: null });
    expect(result.currentLinks).toHaveLength(4);
    expect(result.currentSubmissions).toHaveLength(3);
    expect(result.pastYears).toEqual([]);
  });

  it("moves earlier years into Past years, newest first, once started", () => {
    const result = groupClubFormsByYear({ links, submissions, startedClubYear: "2026-27" });
    expect(result.currentLinks.map((row) => row.id)).toEqual(["l1"]);
    expect(result.currentSubmissions.map((row) => row.id)).toEqual(["s1"]);
    expect(result.pastYears.map((year) => year.clubYear)).toEqual(["2025-26", "2024-25"]);
    expect(result.pastYears[0]!.links.map((row) => row.id)).toEqual(["l2", "l4"]);
    expect(result.pastYears[0]!.submissions.map((row) => row.id)).toEqual(["s3"]);
    expect(result.pastYears[1]!.links.map((row) => row.id)).toEqual(["l3"]);
  });

  it("includes a year that has only filled forms or only links", () => {
    const result = groupClubFormsByYear({ links: [link("l", "2023-24")], submissions: [form("s", "2022-23")], startedClubYear: "2026-27" });
    expect(result.pastYears).toEqual([
      { clubYear: "2023-24", links: [{ id: "l", clubYear: "2023-24" }], submissions: [] },
      { clubYear: "2022-23", links: [], submissions: [{ id: "s", clubYear: "2022-23", rosterMemberId: null }] },
    ]);
  });

  it("applies a member filter made before grouping to the current and the past list alike", () => {
    const all = [form("a-now", "2026-27", "m1"), form("a-old", "2025-26", "m1"), form("b-now", "2026-27", "m2"), form("b-old", "2025-26", "m2")];
    const filtered = all.filter((row) => row.rosterMemberId === "m1");
    const result = groupClubFormsByYear({ links: [], submissions: filtered, startedClubYear: "2026-27" });
    expect(result.currentSubmissions.map((row) => row.id)).toEqual(["a-now"]);
    expect(result.pastYears[0]!.submissions.map((row) => row.id)).toEqual(["a-old"]);
  });

  it("treats a row with no club year as current", () => {
    const result = groupClubFormsByYear({ links: [], submissions: [{ clubYear: undefined }], startedClubYear: "2026-27" });
    expect(result.currentSubmissions).toHaveLength(1);
    expect(result.pastYears).toEqual([]);
  });
});

describe("the next club year", () => {
  const links = [link("a", "2027-28"), link("b", "2026-27"), link("c", "2025-26")];
  const submissions = [form("x", "2026-27"), form("y", "2024-25")];

  it("keeps years moved earlier in Past years and leaves last year current until the new year is started", () => {
    const result = groupClubFormsByYear({ links, submissions, startedClubYear: "2026-27" });
    expect(result.currentLinks.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.currentSubmissions.map((row) => row.id)).toEqual(["x"]);
    expect(result.pastYears.map((year) => year.clubYear)).toEqual(["2025-26", "2024-25"]);
  });

  it("moves last year too after the club starts 2027-28", () => {
    const result = groupClubFormsByYear({ links, submissions, startedClubYear: "2027-28" });
    expect(result.currentLinks.map((row) => row.id)).toEqual(["a"]);
    expect(result.currentSubmissions).toEqual([]);
    expect(result.pastYears.map((year) => year.clubYear)).toEqual(["2026-27", "2025-26", "2024-25"]);
  });
});

describe("the Start the new year button", () => {
  it("shows only with earlier-year forms and no start yet", () => {
    expect(showStartNewYear({ hasEarlierYears: true, yearStarted: false })).toBe(true);
    expect(showStartNewYear({ hasEarlierYears: true, yearStarted: true })).toBe(false);
    expect(showStartNewYear({ hasEarlierYears: false, yearStarted: false })).toBe(false);
  });
});
