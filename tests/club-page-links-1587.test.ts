import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clubDirectoryClubHref, clubSummaryHref } from "@/modules/club-reports/club-directory-domain";
import { clubPageHref, clubPageReturnHref, clubRelatedCards, directoryReturnHref } from "@/modules/club-reports/club-page-links";

const read = (path: string) => readFileSync(path, "utf8");
const directory = clubSummaryHref({ clubYear: "2025-26", query: "Cedar & Oak", attention: true, page: 3 });

describe("directory return (#1587)", () => {
  it("accepts the exact directory URL and rebuilds it from whitelisted parts", () => {
    expect(directoryReturnHref(directory)).toBe(directory);
    expect(directoryReturnHref("/admin/clubs/summary?year=2026-27&view=directory&evil=1")).toBe("/admin/clubs/summary?year=2026-27");
    expect(directoryReturnHref("/admin/clubs/summary?year=2026-27&page=-2")).toBe("/admin/clubs/summary?year=2026-27");
  });

  it("rejects external hosts, other paths, other views, API routes and bad years", () => {
    for (const bad of [
      "https://evil.example/admin/clubs/summary?year=2026-27",
      "//evil.example/admin/clubs/summary?year=2026-27",
      "/\\evil.example",
      "/admin/clubs/reports?year=2026-27",
      "/admin/clubs/summary/../../x",
      "/api/admin/clubs/summary?year=2026-27",
      "/admin/clubs/summary?year=2026-27&view=records",
      "/admin/clubs/summary?year=javascript:1",
      "/admin/clubs/summary",
      "",
      undefined,
      null,
    ]) expect(directoryReturnHref(bad), String(bad)).toBeNull();
  });

  it("keeps the return when the search holds a percent sign or double slash", () => {
    for (const q of ["100%", "a//b", "back\\slash"]) {
      const dir = clubSummaryHref({ clubYear: "2025-26", query: q });
      expect(directoryReturnHref(dir), q).toBe(dir);
      const here = clubPageHref("club-1", "2025-26", dir);
      expect(clubPageReturnHref(here, "club-1"), q).toBe(here);
    }
  });

  it("is carried by the directory card link and read back by the club page", () => {
    const href = clubDirectoryClubHref("club-1", "2025-26", directory);
    const from = new URL(href, "https://x.test").searchParams.get("from");
    expect(from).toBe(directory);
    expect(clubDirectoryClubHref("club-1", "2025-26")).toBe("/admin/organizations/club-1/club?year=2025-26");
  });
});

describe("club page return (#1587)", () => {
  it("keeps the year and the directory view, and still accepts the bare club path", () => {
    const here = clubPageHref("club-1", "2025-26", directory);
    expect(clubPageReturnHref(here, "club-1")).toBe(here);
    expect(clubPageReturnHref("/admin/organizations/club-1/club", "club-1")).toBe("/admin/organizations/club-1/club");
  });

  it("rejects another club, another path, external URLs and a smuggled directory from", () => {
    expect(clubPageReturnHref("/admin/organizations/club-2/club?year=2025-26", "club-1")).toBeNull();
    expect(clubPageReturnHref("/admin/organizations/club-1/directors", "club-1")).toBeNull();
    expect(clubPageReturnHref("https://evil.example/admin/organizations/club-1/club", "club-1")).toBeNull();
    expect(clubPageReturnHref("/admin/organizations/club-1/club?year=2025-26&from=https://evil.example", "club-1")).toBe("/admin/organizations/club-1/club?year=2025-26"); // the external from is dropped, never followed
    expect(clubPageReturnHref(`/admin/organizations/club-1/club?year=2025-26&from=${encodeURIComponent("/admin/clubs/reports")}`, "club-1")).toBe("/admin/organizations/club-1/club?year=2025-26");
    expect(clubPageReturnHref("/admin/organizations/club-1/club?year=bad", "club-1")).toBe("/admin/organizations/club-1/club");
  });
});

describe("the This club cards (#1587)", () => {
  const base = { organizationId: "club-1", clubName: "Synthetic Pathfinders", clubYear: "2025-26", directoryHref: directory };
  const all = { canAdministerClub: true, clubsAdministration: true };

  it("lists the four destinations with the year and a way back to the club page", () => {
    const cards = clubRelatedCards({ ...base, viewer: all });
    expect(cards.map((card) => card.title)).toEqual(["Club admins", "Club profile", "Honors", "Monthly Records"]);
    const from = encodeURIComponent(clubPageHref("club-1", "2025-26", directory));
    expect(cards[0]!.href).toBe(`/admin/organizations/club-1/directors?from=${from}`);
    expect(cards[1]!.href).toBe(`/admin/organizations/club-1/profile?from=${from}`);
    expect(cards[2]!.href).toBe("/admin/organizations/club-1/club/honors?year=2025-26");
    // The records view honours a club-page `from` (#1588) and shows "Back to <club>".
    expect(cards[3]!.href.startsWith(`${clubSummaryHref({ clubYear: "2025-26", view: "records", query: "Synthetic Pathfinders" })}&from=`)).toBe(true);
    expect(cards[3]!.href.endsWith("#monthly-records")).toBe(true);
    expect(new URL(cards[3]!.href, "https://x.test").searchParams.get("from")!.startsWith("/admin/organizations/club-1/club?year=2025-26")).toBe(true);
    expect(cards.every((card) => card.status === null)).toBe(true);
  });

  it("leaves out Monthly Records for an inactive club, whose records the view does not list", () => {
    expect(clubRelatedCards({ ...base, clubActive: false, viewer: all }).map((c) => c.title)).toEqual(["Club admins", "Club profile", "Honors"]);
  });

  it("shows only what the viewer can reach", () => {
    expect(clubRelatedCards({ ...base, viewer: { canAdministerClub: false, clubsAdministration: true } }).map((c) => c.title)).toEqual(["Monthly Records"]);
    expect(clubRelatedCards({ ...base, viewer: { canAdministerClub: true, clubsAdministration: false } }).map((c) => c.title)).toEqual(["Club admins", "Club profile", "Honors"]);
    expect(clubRelatedCards({ ...base, viewer: { canAdministerClub: false, clubsAdministration: false } })).toEqual([]);
  });
});

describe("selected club page source (#1587)", () => {
  const page = read("app/(workspace)/admin/organizations/[organizationId]/club/page.tsx");

  it("renders the card group, a separate Act as Director area, and the directory back link", () => {
    expect(page).toContain('title="This club"');
    expect(page).toContain("club-act-as");
    expect(page).toContain("act-as-director");
    expect(page).toContain("Act as Director (2 hours)");
    expect(page).toContain("Back to Club directory");
    expect(page.indexOf("<HubCardGroup")).toBeLessThan(page.indexOf("<ActAsButton"));
    expect(page).toContain("canAdministerClubOrganization(user, organizationId)");
  });

  it("keeps heading order: This club, Act as Director, then the year overview before the overview's own sections", () => {
    const at = (text: string) => page.indexOf(text);
    expect(at('title="This club"')).toBeGreaterThan(0);
    expect(at("<HubCardGroup")).toBeLessThan(at(">Act as Director</h2>"));
    expect(at(">Act as Director</h2>")).toBeLessThan(at("Club year overview"));
    expect(at("Club year overview")).toBeLessThan(at("<ClubOverview"));
    expect(at("Club year overview")).toBeLessThan(at("<ClubGuardiansPanel"));
  });

  it("adds no birth date, guardian, screening, health or financial fields of its own", () => {
    const cards = read("modules/club-reports/club-page-links.ts");
    for (const word of [/birth/i, /guardian/i, /sterling/i, /health/i, /medical/i, /insurance/i, /balance/i, /payment/i]) {
      expect(cards).not.toMatch(word);
    }
    expect(page.match(/birthDates?/gi)).toHaveLength(1); // only ClubOverview's existing, recorded birth-date reveal
    expect(page).not.toMatch(/healthRecord|insurance/i);
  });

  it("keeps notFound and no-access for removed or inaccessible clubs", () => {
    expect(page).toContain('redirect("/no-access")');
    expect(page).toContain('club.type !== "CLUB"');
    expect(page).toContain("notFound()");
  });

  it("sends the directory its exact view as the return and keeps cards and styles in place", () => {
    expect(read("app/(workspace)/admin/clubs/summary/page.tsx")).toContain("returnTo={clubSummaryHref({ clubYear, query, attention, page: directory.page })}");
    expect(read("components/club-directory.tsx")).toContain("clubDirectoryClubHref(club.id, clubYear, returnTo)");
    expect(read("components/club-directory.module.css")).toContain("min-height: 44px");
    expect(read("app/(workspace)/admin/organizations/[organizationId]/club/club-page.module.css")).not.toContain(":hover");
  });
});
