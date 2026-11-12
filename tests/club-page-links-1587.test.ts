import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clubDirectoryClubHref, clubSummaryHref } from "@/modules/club-reports/club-directory-domain";
import { UNAVAILABLE_STATUS } from "@/modules/system-admin/admin-hubs-model";
import type { ClubCardCounts } from "@/modules/club-reports/club-card-status-domain";
import { clubRecordsCounts, completedHonorsCount } from "@/modules/club-reports/club-card-status-domain";
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
    expect(cards[2]!.href).toBe(`/admin/organizations/club-1/club/honors?year=2025-26&from=${from}`);
    // The records view honours a club-page `from` (#1588) and shows "Back to <club>".
    expect(cards[3]!.href.startsWith(`${clubSummaryHref({ clubYear: "2025-26", view: "records", query: "Synthetic Pathfinders" })}&from=`)).toBe(true);
    expect(cards[3]!.href.endsWith("#monthly-records")).toBe(true);
    expect(new URL(cards[3]!.href, "https://x.test").searchParams.get("from")!.startsWith("/admin/organizations/club-1/club?year=2025-26")).toBe(true);
    expect(cards.every((card) => card.status === null)).toBe(true); // no counts handed in: no status shown
  });

  it("keeps the directory return on the Honors link: a valid from is kept, a foreign or external one is dropped", () => {
    const honors = clubRelatedCards({ ...base, viewer: all })[2]!;
    const from = new URL(honors.href, "https://x.test").searchParams.get("from");
    expect(clubPageReturnHref(from, "club-1")).toBe(clubPageHref("club-1", "2025-26", directory));
    expect(clubPageReturnHref(`/admin/organizations/club-1/club?year=2025-26&from=${encodeURIComponent("https://evil.example/x")}`, "club-1")).toBe("/admin/organizations/club-1/club?year=2025-26");
    expect(clubPageReturnHref("https://evil.example/admin/organizations/club-1/club?year=2025-26", "club-1")).toBeNull();
    expect(clubPageReturnHref("/admin/organizations/club-2/club?year=2025-26", "club-1")).toBeNull();
    const without = clubRelatedCards({ ...base, directoryHref: null, viewer: all })[2]!;
    expect(clubPageReturnHref(new URL(without.href, "https://x.test").searchParams.get("from"), "club-1")).toBe("/admin/organizations/club-1/club?year=2025-26");
  });

  const statuses = (counts: ClubCardCounts, extra: object = {}) =>
    Object.fromEntries(clubRelatedCards({ ...base, clubActive: true, clubHasChurch: true, counts, ...extra, viewer: all }).map((card) => [card.title, card.status]));

  it("words each status: zero, one and many", () => {
    expect(statuses({ admins: 0 })["Club admins"]).toEqual({ tone: "warn", text: "No admins" });
    expect(statuses({ admins: 1 })["Club admins"]).toEqual({ tone: "ok", text: "1 admin" });
    expect(statuses({ admins: 3 })["Club admins"]).toEqual({ tone: "ok", text: "3 admins" });
    expect(statuses({ honors: 0 })["Honors"]).toEqual({ tone: "draft", text: "None earned" });
    expect(statuses({ honors: 1 })["Honors"]).toEqual({ tone: "ok", text: "1 honor" });
    expect(statuses({ honors: 7 })["Honors"]).toEqual({ tone: "ok", text: "7 honors" });
    expect(statuses({ records: { missing: 2, submitted: 5 } })["Monthly Records"]).toEqual({ tone: "warn", text: "2 missing" });
    expect(statuses({ records: { missing: 0, submitted: 4 } })["Monthly Records"]).toEqual({ tone: "ok", text: "4 submitted" });
    expect(statuses({ records: { missing: 0, submitted: 0 } })["Monthly Records"]).toEqual({ tone: "draft", text: "None due yet" });
  });

  it("words the profile status from the club's own fields", () => {
    expect(statuses({})["Club profile"]).toEqual({ tone: "ok", text: "Church listed" });
    expect(statuses({}, { clubHasChurch: false })["Club profile"]).toEqual({ tone: "warn", text: "No church listed" });
    expect(statuses({}, { clubActive: false, clubHasChurch: false })["Club profile"]).toEqual({ tone: "draft", text: "Inactive" });
  });

  it("says Unavailable for a failed read and shows nothing for one that was not made", () => {
    const failed = statuses({ admins: null, honors: null, records: null });
    expect(failed["Club admins"]).toEqual(UNAVAILABLE_STATUS);
    expect(failed["Honors"]).toEqual(UNAVAILABLE_STATUS);
    expect(failed["Monthly Records"]).toEqual(UNAVAILABLE_STATUS);
    expect(statuses({})["Club admins"]).toBeNull();
  });

  it("gives no status or card for a viewer without the gate", () => {
    const counts = { admins: 2, honors: 2, records: { missing: 1, submitted: 1 } };
    const records = clubRelatedCards({ ...base, counts, viewer: { canAdministerClub: false, clubsAdministration: true } });
    expect(records.map((card) => [card.title, card.status?.text])).toEqual([["Monthly Records", "1 missing"]]);
    const club = clubRelatedCards({ ...base, counts, viewer: { canAdministerClub: true, clubsAdministration: false } });
    expect(club.map((card) => card.title)).toEqual(["Club admins", "Club profile", "Honors"]);
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

  it("has the Honors page return through the validated club-page from", () => {
    const honors = read("app/(workspace)/admin/organizations/[organizationId]/club/honors/page.tsx");
    expect(honors).toContain("clubPageReturnHref(");
    expect(honors).toContain("?? clubPageHref(organizationId, clubYear)");
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

describe("card counts (#1587)", () => {
  it("counts months past due with no submitted report, as the Monthly Records grid does", () => {
    const now = new Date("2026-11-12T15:00:00Z"); // September's report was due Oct 10, October's is due Nov 10
    expect(clubRecordsCounts({ clubYear: "2026-27", submittedMonths: [], joinedOn: null, now })).toEqual({ submitted: 0, missing: 2 });
    expect(clubRecordsCounts({ clubYear: "2026-27", submittedMonths: ["2026-09"], joinedOn: null, now })).toEqual({ submitted: 1, missing: 1 });
    expect(clubRecordsCounts({ clubYear: "2026-27", submittedMonths: ["2026-09", "2026-10"], joinedOn: null, now })).toEqual({ submitted: 2, missing: 0 });
    // a club that joined in November owes nothing for September or October
    expect(clubRecordsCounts({ clubYear: "2026-27", submittedMonths: [], joinedOn: "2026-11-01", now })).toEqual({ submitted: 0, missing: 0 });
    // a month not yet due is not missing
    expect(clubRecordsCounts({ clubYear: "2026-27", submittedMonths: [], joinedOn: null, now: new Date("2026-09-20T15:00:00Z") })).toEqual({ submitted: 0, missing: 0 });
  });

  it("counts the latest non-voided entry per member and honor, completed only", () => {
    const entry = (personId: string, honorId: string, status: string, voided = false) => ({ personId, honorId, status, voided });
    expect(completedHonorsCount([])).toBe(0);
    expect(completedHonorsCount([entry("p1", "h1", "COMPLETED")])).toBe(1);
    expect(completedHonorsCount([entry("p1", "h1", "COMPLETED", true), entry("p1", "h1", "COMPLETED")])).toBe(1);
    expect(completedHonorsCount([entry("p1", "h1", "COMPLETED", true)])).toBe(0);
    expect(completedHonorsCount([entry("p1", "h1", "IN_PROGRESS"), entry("p1", "h1", "COMPLETED")])).toBe(0); // the later entry wins
    expect(completedHonorsCount([entry("p1", "h1", "COMPLETED"), entry("p2", "h1", "COMPLETED"), entry("p1", "h2", "COMPLETED")])).toBe(3);
  });
});
