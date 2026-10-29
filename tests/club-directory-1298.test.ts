import { describe, expect, it } from "vitest";
import { buildClubDirectory, clubDirectoryClubHref, clubSummaryHref, parseClubSummaryView } from "@/modules/club-reports/club-directory-domain";
import { summarizeClub, type MonthCell } from "@/modules/club-reports/area-summary-domain";
import { clubSummaryLegacyUrl } from "@/components/club-summary-legacy-anchor";
import { clubYearSelectorModel } from "@/components/clubs-year-selector-model";
import { buildAdminSectionNav } from "@/components/admin-section-nav";

const now = new Date("2026-10-26T18:00:00Z");
const clubYear = "2026-27";
const club = (id: string, name: string, status: MonthCell["status"] = "DUE", reviewed = false) => ({
  ...summarizeClub({ id, name, church: "Synthetic Cedar Church", directors: [], rosterSize: 7, registrationOnTime: true, reports: [], backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 } }, clubYear, now),
  months: [{ month: "2026-10", status, reviewed, points: 0 }],
});
const base = { now, clubYear, clubs: [] as ReturnType<typeof club>[] };

describe("club directory projection", () => {
  it("uses monthly-record states only for Needs attention; future and unavailable records are distinct", () => {
    const clubs = [club("reviewed", "Reviewed", "SUBMITTED", true), club("late", "Late", "LATE"), club("draft", "Draft", "DRAFT"), club("due", "Due"), club("missing", "Missing", "MISSING"), club("future", "Future", "FUTURE"), { ...club("unavailable", "Unavailable"), months: [] }];
    expect(buildClubDirectory({ ...base, clubs, attention: true }).items.map((row) => row.id)).toEqual(["draft", "due", "late", "missing"]);
    const rows = buildClubDirectory({ ...base, clubs }).items;
    expect(rows.find((row) => row.id === "late")).toMatchObject({ recordLabel: "Submitted", needsAttention: true });
    expect(rows.find((row) => row.id === "future")).toMatchObject({ recordLabel: "Not yet due", needsAttention: false });
    expect(rows.find((row) => row.id === "unavailable")).toMatchObject({ recordLabel: "Record unavailable", needsAttention: false });
    expect(rows.find((row) => row.id === "reviewed")).toMatchObject({ recordLabel: "Reviewed", needsAttention: false });
  });

  it("combines name/church search with attention filtering before paging, retaining the total", () => {
    const clubs = Array.from({ length: 29 }, (_, i) => club(String(i), `Club ${String(i).padStart(2, "0")}`, "SUBMITTED", i === 0));
    const page = buildClubDirectory({ ...base, clubs, query: "  cedar  ", attention: true, page: 2 });
    expect(page).toMatchObject({ total: 28, totalClubs: 29, page: 2, pageCount: 3, from: 13, to: 24, query: "cedar" });
    expect(page.items).toHaveLength(12);
    expect(page.items[0]!.name).toBe("Club 13");
    expect(buildClubDirectory({ ...base, clubs, query: "Club 28" }).items.map((row) => row.id)).toEqual(["28"]);
    expect(buildClubDirectory({ ...base, clubs, query: "absent", page: 100 })).toMatchObject({ items: [], total: 0, from: 0, to: 0, page: 1 });
    expect(buildClubDirectory({ ...base, clubs, page: Infinity }).page).toBe(1);
    expect(buildClubDirectory({ ...base, clubs, page: -3 }).page).toBe(1);
    expect(buildClubDirectory({ ...base, clubs, page: 999 }).page).toBe(3);
    expect(clubs[0]!.id).toBe("0"); // Input order is never mutated.
  });

  it("limits the home preview to six and puts monthly work before reviewed clubs", () => {
    const clubs = Array.from({ length: 9 }, (_, i) => club(String(i), `Club ${i}`, "SUBMITTED", i < 6));
    const page = buildClubDirectory({ ...base, clubs, pageSize: 6, prioritizeAttention: true });
    expect(page.items.map((row) => row.id)).toEqual(["6", "7", "8", "0", "1", "2"]);
    expect(page.total).toBe(9);
  });

  it("selects the last month in a historical year and never flags future records as overdue", () => {
    const old = { ...club("old", "Old"), months: [{ month: "2025-08", status: "SUBMITTED" as const, reviewed: true, points: 0 }] };
    expect(buildClubDirectory({ ...base, clubs: [old], clubYear: "2024-25" }).items[0]).toMatchObject({ recordLabel: "Reviewed", needsAttention: false });
    expect(buildClubDirectory({ ...base, clubs: [club("future", "Future", "FUTURE")], attention: true }).items).toEqual([]);
  });
});

describe("directory and report navigation", () => {
  it("preserves filters, page, view and selected year in encoded links", () => {
    const href = clubSummaryHref({ clubYear, query: "Cedar & Oak", attention: true, page: 2, view: "directory" });
    const params = new URL(href, "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({ year: clubYear, view: "directory", q: "Cedar & Oak", attention: "needs-attention", page: "2" });
    expect(clubDirectoryClubHref("club /1", "2024-25")).toBe("/admin/organizations/club%20%2F1/club?year=2024-25");
    expect(parseClubSummaryView(undefined, "name")).toBe("points");
    expect(parseClubSummaryView("directory", "name")).toBe("directory");
    expect(parseClubSummaryView("invalid")).toBe("directory");
  });

  it("restores old hash bookmarks without losing year, sort or search", () => {
    expect(clubSummaryLegacyUrl("https://example.test/admin/clubs/summary?year=2024-25&sort=name&q=Cedar#points")).toBe("/admin/clubs/summary?year=2024-25&sort=name&q=Cedar&view=points#points");
    expect(clubSummaryLegacyUrl("https://example.test/admin/clubs/summary#club-events")).toBe("/admin/clubs/summary?view=events#club-events");
    expect(clubSummaryLegacyUrl("https://example.test/admin/clubs/summary#monthly-records")).toBe("/admin/clubs/summary?view=records#monthly-records");
    expect(clubSummaryLegacyUrl("https://example.test/admin/clubs/summary?view=points#points")).toBeNull();
    expect(clubSummaryLegacyUrl("https://example.test/admin/clubs/summary#unrelated")).toBeNull();
  });

  it("keeps the view/search/filter when changing year and resets pagination", () => {
    const model = clubYearSelectorModel("/admin/clubs/summary", clubYear, now, new URLSearchParams("view=directory&q=Cedar&attention=needs-attention&page=3"));
    expect(model.carry).toEqual([["q", "Cedar"], ["view", "directory"], ["attention", "needs-attention"]]);
  });

  it("marks the selected report in the Clubs section header", () => {
    for (const [view, key, current] of [["directory", "all-clubs", "page"], ["records", "monthly-records", "true"], ["points", "points", "page"], ["events", "club-events", "page"]] as const) {
      const nav = buildAdminSectionNav({ section: "clubs", pathname: "/admin/clubs/summary", clubYear, clubSummaryView: view });
      expect(nav.tabs.filter((tab) => tab.current).map((tab) => [tab.key, tab.current])).toEqual([[key, current]]);
    }
    expect(buildAdminSectionNav({ section: "clubs", pathname: "/admin/organizations/club-1/club", clubYear: "2024-25" }).back?.href).toBe("/admin/clubs/summary?year=2024-25");
  });
});

describe("club summary year selector (#1304)", () => {
  it("does not carry search or attention into a report view", () => {
    const model = clubYearSelectorModel("/admin/clubs/summary", clubYear, now, new URLSearchParams("view=points&q=Cedar&attention=needs-attention&sort=points"));
    expect(model.carry).toEqual([["sort", "points"], ["view", "points"]]);
  });
});
