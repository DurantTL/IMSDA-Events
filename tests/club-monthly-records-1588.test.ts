import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaTabs, markCurrentTab, staffPlaceFor, visibleAreas, type StaffAreaViewer } from "@/components/staff-areas";
import { maxViewsPerTab } from "@/components/staff-event-tabs";
import {
  parseClubPageFrom,
  parseRecordFrom,
  recordBackLabel,
  recordBackLink,
  recordFromParam,
  withRecordFrom,
} from "@/modules/club-reports/record-return-domain";

const base: StaffAreaViewer = { isSystemAdmin: false, held: [], activeRole: null, hasEvents: false, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };
const clubsAdmin: StaffAreaViewer = { ...base, held: ["CLUBS_ADMIN"], activeRole: "CLUBS_ADMIN" };
const eventsOnly: StaffAreaViewer = { ...base, hasEvents: true, held: ["EVENTS_ADMIN"], activeRole: "EVENTS_ADMIN" };
const read = (path: string) => readFileSync(path, "utf8");

describe("Monthly records tab views (#1588)", () => {
  const tab = (viewer: StaffAreaViewer) => areaTabs("clubs", viewer).find((item) => item.key === "monthly-records");

  it("lists Monthly Records, Year-end, Review monthly records and Points, within the five-view cap", () => {
    const views = tab(clubsAdmin)!.views!;
    expect(views.map((view) => view.label)).toEqual(["Monthly Records", "Club Year-End Reports", "Review monthly records", "Points"]);
    expect(views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(views.map((view) => view.href)).toEqual(["/admin/clubs/summary?view=records#monthly-records", "/admin/clubs/reports/year-end", "/admin/clubs/reports", "/admin/clubs/summary?view=points#points"]);
  });

  it("shows nothing to someone without Clubs administration", () => {
    expect(tab(eventsOnly)).toBeUndefined();
    expect(tab(base)).toBeUndefined();
  });

  it("carries the club year on every view", () => {
    const views = tab({ ...clubsAdmin, clubYear: "2025-26" })!.views!;
    expect(views.map((view) => new URL(view.href, "https://x.test").searchParams.get("year"))).toEqual(["2025-26", "2025-26", "2025-26", "2025-26"]);
  });

  it("marks the one current view on each page of the tab", () => {
    const cases: Array<[string, string, string]> = [
      ["/admin/clubs/summary", "view=records", "/admin/clubs/summary?view=records#monthly-records"],
      ["/admin/clubs/summary", "view=points", "/admin/clubs/summary?view=points#points"],
      ["/admin/clubs/reports", "", "/admin/clubs/reports"],
      ["/admin/clubs/reports", "review=to-review&month=2026-10", "/admin/clubs/reports"],
      ["/admin/clubs/reports/org_1/2026-10", "", "/admin/clubs/reports"],
      ["/admin/clubs/reports/org_1/2026-10", "from=%2Fadmin%2Fclubs%2Freports%3Fyear%3D2026-27", "/admin/clubs/reports"],
      ["/admin/clubs/reports/org_1/2026-10", "from=%2Fadmin%2Fclubs%2Fsummary%3Fview%3Drecords", "/admin/clubs/summary?view=records#monthly-records"],
    ];
    for (const [path, query, view] of cases) {
      const place = staffPlaceFor(path, new URLSearchParams(query));
      expect([path, place.area, place.tab]).toEqual([path, "clubs", "monthly-records"]);
      const marked = markCurrentTab(areaTabs("clubs", clubsAdmin), place).find((item) => item.key === "monthly-records")!;
      expect(marked.current).toBe(true);
      expect([path, query, marked.views!.filter((item) => item.current).map((item) => item.key)]).toEqual([path, query, [view]]);
    }
  });

  it("lights Clubs -> Monthly records -> Year-end for the year-end page, and Reports is not a Clubs Administrator's row (#1841)", () => {
    const place = staffPlaceFor("/admin/clubs/reports/year-end");
    expect(place).toMatchObject({ area: "clubs", tab: "monthly-records", view: "/admin/clubs/reports/year-end" });
    const marked = markCurrentTab(areaTabs("clubs", clubsAdmin), place).find((item) => item.key === "monthly-records")!;
    expect(marked.views!.filter((item) => item.current).map((item) => item.key)).toEqual(["/admin/clubs/reports/year-end"]);
    expect(areaTabs("reports", clubsAdmin)).toEqual([]);
    expect(visibleAreas(clubsAdmin)).not.toContain("reports");
    // A record whose `from` is not the Monthly Records view stays on the Review view; the Year-end page is not under it.
    expect(staffPlaceFor("/admin/clubs/reports/org_1/2026-10", new URLSearchParams("from=/admin/organizations/org_1/club")).view).toBe("/admin/clubs/reports");
  });
});

describe("record return address (#1588)", () => {
  it("rebuilds each parent with its year, month, filter, sort and page", () => {
    expect(recordFromParam("/admin/clubs/reports", "year=2025-26&review=to-review&month=2026-03&reviewSort=points&reviewDir=desc&junk=1"))
      .toBe("/admin/clubs/reports?year=2025-26&month=2026-03&review=to-review&reviewSort=points&reviewDir=desc");
    expect(recordFromParam("/admin/clubs/reports", "year=2026-27&recordsSort=month-2026-10&recordsDir=asc")).toBe("/admin/clubs/reports?year=2026-27&recordsSort=month-2026-10&recordsDir=asc");
    expect(recordFromParam("/admin/clubs/summary", "view=records&year=2026-27&month=2026-10&q=Eagle+Ridge&show=all&sort=club&dir=asc&attention=x"))
      .toBe("/admin/clubs/summary?view=records&year=2026-27&month=2026-10&q=Eagle+Ridge&show=all&sort=club&dir=asc#monthly-records");
    expect(recordFromParam("/admin/organizations/org_1/club", "year=2025-26&x=1")).toBe("/admin/organizations/org_1/club?year=2025-26");
  });

  it("is not a parent for the points view, the directory or any other page", () => {
    expect(recordFromParam("/admin/clubs/summary", "view=points")).toBeNull();
    expect(recordFromParam("/admin/clubs/summary", "")).toBeNull();
    expect(recordFromParam("/admin/clubs/reports/year-end", "")).toBeNull();
    expect(recordFromParam("/admin/people", "")).toBeNull();
  });

  it("drops values that do not have the right shape", () => {
    expect(recordFromParam("/admin/clubs/reports", "year=../../x&month=abc&review=other&reviewSort=a b&reviewDir=sideways")).toBe("/admin/clubs/reports");
    expect(recordFromParam("/admin/clubs/summary", `view=records&q=${"x".repeat(81)}`)).toBe("/admin/clubs/summary?view=records#monthly-records");
  });

  it("adds from before any hash, encoded", () => {
    expect(withRecordFrom("/admin/clubs/reports/o/2026-10?year=2026-27", "/admin/clubs/reports?year=2026-27")).toBe("/admin/clubs/reports/o/2026-10?year=2026-27&from=%2Fadmin%2Fclubs%2Freports%3Fyear%3D2026-27");
    expect(withRecordFrom("/admin/clubs/summary?view=records#monthly-records", "/x")).toBe("/admin/clubs/summary?view=records&from=%2Fx#monthly-records");
    expect(withRecordFrom("/a", null)).toBe("/a");
  });

  it("accepts the three parents and the same club's page only", () => {
    expect(parseRecordFrom("/admin/clubs/reports?year=2025-26&review=to-review", { organizationId: "org_1" })).toEqual({ kind: "review", href: "/admin/clubs/reports?year=2025-26&review=to-review" });
    expect(parseRecordFrom("/admin/clubs/summary?view=records&year=2025-26&month=2026-03", { organizationId: "org_1" })?.kind).toBe("records");
    expect(parseRecordFrom("/admin/organizations/org_1/club?year=2025-26", { organizationId: "org_1" })).toEqual({ kind: "club", href: "/admin/organizations/org_1/club?year=2025-26" });
    expect(parseRecordFrom("/admin/organizations/org_2/club?year=2025-26", { organizationId: "org_1" })).toBeNull();
  });

  it("rejects attack inputs", () => {
    const attacks = [
      "https://evil.example/admin/clubs/reports",
      "//evil.example/admin/clubs/reports",
      "/\\evil.example",
      "\\admin\\clubs\\reports",
      "/admin/clubs/reports//x",
      "/admin/people",
      "/admin/clubs/reports/year-end",
      "/admin/clubs/reports/org_1/2026-10",
      "/admin/clubs/summary?view=points",
      "/admin/clubs/summary?year=2025-26",
      "/api/admin/club-reports/export",
      "javascript:alert(1)",
      "/admin/clubs/reports%2F..%2F..%2Fapi",
      "%2F%2Fevil.example",
      "/admin/organizations/org_1/club/honors",
      "/admin/organizations/org_1/club\n",
      "",
    ];
    for (const attack of attacks) expect([attack, parseRecordFrom(attack, { organizationId: "org_1" })]).toEqual([attack, null]);
    expect(parseRecordFrom(null)).toBeNull();
    expect(parseRecordFrom(undefined)).toBeNull();
  });

  it("drops any nested from, so a bad one never rides along", () => {
    expect(parseRecordFrom("/admin/clubs/reports?year=2025-26&from=https%3A%2F%2Fevil.example")?.href).toBe("/admin/clubs/reports?year=2025-26");
    expect(parseRecordFrom("/admin/organizations/org_1/club?year=2025-26&from=%2F%2Fevil.example", { organizationId: "org_1" })?.href).toBe("/admin/organizations/org_1/club?year=2025-26");
    expect(parseRecordFrom("/admin/clubs/reports?year=2025-26&from=%2Fadmin%2Fpeople")?.href).toBe("/admin/clubs/reports?year=2025-26");
  });

  it("names the back link for its parent and returns to the exact address", () => {
    const input = { organizationId: "org_1", clubName: "Eagle Ridge", clubYear: "2026-27" };
    expect(recordBackLink("/admin/clubs/reports?year=2025-26&review=to-review&reviewSort=points", input)).toEqual({ href: "/admin/clubs/reports?year=2025-26&review=to-review&reviewSort=points", label: "Back to Review monthly records" });
    expect(recordBackLink("/admin/clubs/summary?view=records&year=2025-26&month=2026-03&q=Eagle", input)).toEqual({ href: "/admin/clubs/summary?view=records&year=2025-26&month=2026-03&q=Eagle#monthly-records", label: "Back to Monthly Records" });
    expect(recordBackLink("/admin/organizations/org_1/club?year=2025-26", input)).toEqual({ href: "/admin/organizations/org_1/club?year=2025-26", label: "Back to Eagle Ridge" });
    expect(recordBackLink("/admin/organizations/org_9/club", input)).toEqual({ href: "/admin/clubs/reports?year=2026-27", label: "Back to Review monthly records" });
    expect(recordBackLink(undefined, input).label).toBe("Back to Review monthly records");
    expect(recordBackLabel("club")).toBe("Back to the club");
  });

  it("keeps the way back when a records search holds %, // or a backslash", () => {
    const input = { organizationId: "org_1", clubName: "Eagle Ridge", clubYear: "2026-27" };
    for (const q of ["100%", "a//b", "a\\b", "50%25"]) {
      const from = recordFromParam("/admin/clubs/summary", new URLSearchParams({ view: "records", year: "2026-27", q }))!;
      expect(from).toContain("q=");
      const back = recordBackLink(from, input);
      expect([q, back.label]).toEqual([q, "Back to Monthly Records"]);
      expect(new URL(back.href, "https://x.test").searchParams.get("q")).toBe(q);
    }
    // A bad path is still refused even when the query is harmless.
    expect(parseRecordFrom("//evil.example/admin/clubs/summary?view=records")).toBeNull();
    expect(parseRecordFrom("/admin/clubs/summary\\x?view=records")).toBeNull();
  });

  it("keeps the nested directory return on the club page link", () => {
    const dir = "/admin/clubs/summary?year=2025-26&q=Eagle&page=2";
    const from = `/admin/organizations/org_1/club?year=2025-26&from=${encodeURIComponent(dir)}`;
    const club = parseClubPageFrom(from);
    expect(club?.organizationId).toBe("org_1");
    expect(club?.href).toContain("/admin/organizations/org_1/club?year=2025-26&from=");
    expect(decodeURIComponent(club!.href)).toContain("q=Eagle");
    expect(decodeURIComponent(club!.href)).toContain("page=2");
    expect(parseClubPageFrom(`/admin/organizations/org_1/club?year=2025-26&from=${encodeURIComponent("https://evil.example")}`)?.href).toBe("/admin/organizations/org_1/club?year=2025-26");
  });

  it("reads a club page from for the records view and rejects others", () => {
    expect(parseClubPageFrom("/admin/organizations/org_1/club?year=2025-26")).toEqual({ organizationId: "org_1", href: "/admin/organizations/org_1/club?year=2025-26" });
    expect(parseClubPageFrom("/admin/clubs/reports?year=2025-26")).toBeNull();
    expect(parseClubPageFrom("//evil.example/admin/organizations/org_1/club")).toBeNull();
    expect(parseClubPageFrom("/admin/organizations/../club")).toBeNull();
    expect(parseClubPageFrom(null)).toBeNull();
  });
});

describe("Monthly records pages (#1588)", () => {
  it("the record page uses the validated named back link and keeps the club page link", () => {
    const page = read("app/(workspace)/admin/clubs/reports/[organizationId]/[month]/page.tsx");
    expect(page).toContain("recordBackLink(from");
    expect(page).toContain("back={back}");
    expect(page).not.toContain("allowedReturnTo");
  });

  it("every list that opens a record carries a from", () => {
    expect(read("components/club-screen-tables.tsx")).toContain("withRecordFrom(`/admin/clubs/reports/${encodeURIComponent(row.id)}/${row.month}`, from)");
    expect(read("components/club-reports-conference.tsx")).toContain("withRecordFrom(`/admin/clubs/reports/${encodeURIComponent(club.id)}/${month}`, from)");
    const summary = read("app/(workspace)/admin/clubs/summary/page.tsx");
    expect(summary).toContain("withRecordFrom(`/admin/clubs/reports/");
    expect(summary).toContain("parseClubPageFrom(params.from)");
    expect(summary).toContain("Back to {fromClubName}");
    expect(summary).toContain("fromClubName ? clubFrom : null");
  });

  it("export buttons and year links are 44px tap targets from a CSS module", () => {
    const css = read("components/staff-records-nav.module.css");
    expect(css).toMatch(/a\.target\s*\{[^}]*min-height:\s*44px/);
    expect(read("components/area-clubs-views.tsx")).toContain("navStyles.target");
    expect(read("app/(workspace)/admin/clubs/reports/page.tsx").match(/navStyles\.target/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read("app/(workspace)/admin/clubs/reports/year-end/page.tsx").match(/navStyles\.target/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the review grid's cell links, registration box and export are 44px at every width", () => {
    const grid = read("components/club-reports-conference.tsx");
    expect(grid.match(/styles\.cellLink/g)?.length).toBe(3);
    expect(grid.match(/styles\.target/g)?.length).toBe(2);
    const css = read("components/club-reports-conference.module.css");
    expect(css).toMatch(/a\.cellLink \{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
    expect(css).not.toMatch(/@media/);
  });

  it("the Year-End list and its link from the review list carry the year (#1588)", () => {
    expect(read("app/(workspace)/admin/clubs/reports/page.tsx")).toContain("href={`/admin/clubs/reports/year-end?year=${clubYear}`}");
    expect(read("app/(workspace)/admin/clubs/reports/year-end/page.tsx")).toContain('back={{ href: `/admin/clubs/reports?year=${reportYear}`, label: "Back to Review monthly records" }}');
    expect(read("app/(workspace)/admin/clubs/reports/page.tsx")).toContain('back={{ href: clubsAdminHrefs(clubYear).records, label: "Back to Monthly Records" }}');
  });

  it("the Year-End search box is a 44px tap target", () => {
    expect(read("components/club-year-end-conference.tsx")).toContain("className={styles.search}");
    expect(read("components/club-year-end-conference.module.css")).toMatch(/input\.search \{\s*min-height: 44px;/);
  });
});
