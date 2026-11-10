import { describe, expect, it } from "vitest";
import {
  filterYearEndRows,
  inYearEndTab,
  matchesYearEndSearch,
  parseYearEndFrom,
  parseYearEndTab,
  yearEndBackLink,
  yearEndDetailHref,
  yearEndFromParam,
  yearEndStatusCounts,
  yearEndStatusLabel,
  yearEndTabCounts,
  type YearEndListRow,
} from "@/modules/club-reports/year-end-list-domain";

const row = (over: Partial<YearEndListRow> & { id: string }): YearEndListRow => ({
  name: "Club", church: "Test Church", status: "NONE", late: false, directors: [], ...over,
});
const rows: YearEndListRow[] = [
  row({ id: "a", name: "Alpha Pathfinders", church: "Maple Church", status: "SUBMITTED", late: true, directors: ["Dana Example"] }),
  row({ id: "b", name: "Bravo Eagles", church: "Oak Church", status: "SUBMITTED", directors: ["Sam Sample", "Lee Example"] }),
  row({ id: "c", name: "Charlie Guides", church: "Maple Church", status: "DRAFT", directors: ["Pat Test"] }),
  row({ id: "d", name: "Delta Scouts", church: "Pine Church", status: "NONE" }),
];

describe("year-end list buckets and counts (#1843)", () => {
  it("counts submitted (with late), drafts and missing", () => {
    expect(yearEndStatusCounts(rows)).toEqual({ submitted: 2, late: 1, draft: 1, missing: 1 });
    expect(yearEndStatusCounts([])).toEqual({ submitted: 0, late: 0, draft: 0, missing: 0 });
  });

  it("puts submitted reports in Needs review and drafts plus missing in Not submitted", () => {
    expect(rows.filter((r) => inYearEndTab(r, "needs-review")).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.filter((r) => inYearEndTab(r, "not-submitted")).map((r) => r.id)).toEqual(["c", "d"]);
    expect(rows.filter((r) => inYearEndTab(r, "all"))).toHaveLength(4);
    expect(yearEndTabCounts(rows)).toEqual({ "needs-review": 2, "not-submitted": 2, all: 4 });
  });

  it("reads the tab from the address, defaulting to Needs review", () => {
    expect(parseYearEndTab(null)).toBe("needs-review");
    expect(parseYearEndTab("bogus")).toBe("needs-review");
    expect(parseYearEndTab("not-submitted")).toBe("not-submitted");
    expect(parseYearEndTab("all")).toBe("all");
  });

  it("words each status", () => {
    expect(yearEndStatusLabel("SUBMITTED", true)).toBe("Submitted (late)");
    expect(yearEndStatusLabel("SUBMITTED", false)).toBe("Submitted");
    expect(yearEndStatusLabel("DRAFT", false)).toBe("Draft (not submitted)");
    expect(yearEndStatusLabel("NONE", false)).toBe("Missing");
  });
});

describe("year-end list search", () => {
  it("an empty search shows every club in the tab (S1)", () => {
    expect(filterYearEndRows(rows, "all", "")).toHaveLength(4);
    expect(filterYearEndRows(rows, "all", "   ")).toHaveLength(4);
    expect(filterYearEndRows(rows, "needs-review", "")).toHaveLength(2);
  });

  it("matches club, church or director, ignoring case and extra spaces, with no minimum length (S2)", () => {
    expect(filterYearEndRows(rows, "all", "bravo").map((r) => r.id)).toEqual(["b"]);
    expect(filterYearEndRows(rows, "all", "MAPLE").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterYearEndRows(rows, "all", "example").map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterYearEndRows(rows, "all", "  dana   example ").map((r) => r.id)).toEqual(["a"]);
    expect(filterYearEndRows(rows, "all", "p").length).toBeGreaterThan(0);
  });

  it("narrows within the chosen tab", () => {
    expect(filterYearEndRows(rows, "needs-review", "maple").map((r) => r.id)).toEqual(["a"]);
    expect(filterYearEndRows(rows, "not-submitted", "maple").map((r) => r.id)).toEqual(["c"]);
    expect(filterYearEndRows(rows, "all", "nobody")).toEqual([]);
    expect(matchesYearEndSearch(rows[3]!, "pine")).toBe(true);
  });
});

describe("year-end list kept place", () => {
  it("rebuilds the list address from allowed parameters only", () => {
    expect(yearEndFromParam("year=2025-26&tab=all&q=maple&yearEndSort=club&yearEndDir=desc&page=2&evil=1")).toBe(
      "/admin/clubs/reports/year-end?year=2025-26&tab=all&q=maple&yearEndSort=club&yearEndDir=desc&page=2",
    );
    expect(yearEndFromParam("tab=nope&page=x")).toBe("/admin/clubs/reports/year-end");
    expect(yearEndFromParam("")).toBe("/admin/clubs/reports/year-end");
  });

  it("accepts only the list's own address as a from", () => {
    expect(parseYearEndFrom("/admin/clubs/reports/year-end?tab=all&page=3&x=1")).toBe("/admin/clubs/reports/year-end?tab=all&page=3");
    expect(parseYearEndFrom("/admin/clubs/reports/year-end")).toBe("/admin/clubs/reports/year-end");
    expect(parseYearEndFrom("https://example.test/admin/clubs/reports/year-end")).toBeNull();
    expect(parseYearEndFrom("//example.test")).toBeNull();
    expect(parseYearEndFrom("/admin/clubs/reports")).toBeNull();
    expect(parseYearEndFrom(null)).toBeNull();
  });

  it("links a club's detail with its from, and goes back to the list as it was left", () => {
    const from = yearEndFromParam("tab=not-submitted&q=oak");
    const href = yearEndDetailHref("club-1", "2025-26", from);
    expect(href).toBe(`/admin/clubs/reports/year-end/club-1/2025-26?from=${encodeURIComponent(from)}`);
    expect(yearEndBackLink(from, "2025-26")).toEqual({ href: from, label: "Back to Year-End Reports" });
    expect(yearEndBackLink("//evil.test", "2025-26").href).toBe("/admin/clubs/reports/year-end?year=2025-26");
    expect(yearEndDetailHref("club-1", "2025-26", null)).toBe("/admin/clubs/reports/year-end/club-1/2025-26");
  });
});
