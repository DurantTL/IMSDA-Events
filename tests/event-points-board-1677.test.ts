import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/area-clubs/points",
}));

import { ClubEventPointsList } from "@/components/club-event-points";
import { PointsBars } from "@/components/club-report-charts";
import { CoordinatorPointsRanking } from "@/components/coordinator-points";
import { EventPointsByClub } from "@/components/event-points-by-club";
import { serverSort } from "@/lib/list-sort";
import { areaPointsCsv, areaSummaryCsv, eventAwardRows, registrationPointsOf, summarizeClub } from "@/modules/club-reports/area-summary-domain";
import { COORDINATOR_RANKING_DEFAULT_SORT, COORDINATOR_RANKING_SORT_COLUMNS, rankingFirstDirection } from "@/modules/club-reports/area-table-sort";
import { yearToDate } from "@/modules/club-reports/domain";

/**
 * #1677: event attendance points on the club points board. They add to a club's total with the event as the reason, never
 * touch Monthly Records points or the yearly registration points, and show a column only once a club has some.
 * Synthetic clubs only.
 */
const now = new Date("2026-11-08T12:00:00Z");
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };
const report = { reportMonth: "2026-09", status: "SUBMITTED" as const, totalPoints: 200, onTimePoints: 25 };
const input = (id: string, name: string, extra: Partial<Parameters<typeof summarizeClub>[0]> = {}) => ({
  id, name, church: "Sample Church", directors: [], rosterSize: 10, registrationOnTime: true, backgroundChecks: noChecks, reports: [report], ...extra,
});
const withEvents = summarizeClub(input("a", "Alpha Club", { attendancePoints: { total: 1700, awards: [{ eventName: "Sample Spring Camporee", points: 1500 }, { eventName: "Sample Leadership Weekend", points: 200 }] } }), "2026-27", now);
const without = summarizeClub(input("b", "Beta Club"), "2026-27", now);

describe("the club points total", () => {
  it("adds event points to the total and leaves report and registration points alone", () => {
    expect(withEvents.reportPoints).toBe(200);
    expect(withEvents.eventPoints).toBe(1700);
    expect(withEvents.totalPoints).toBe(200 + 1500 + 1700);
    expect(registrationPointsOf(withEvents)).toBe(1500);
    expect(without.totalPoints).toBe(1700);
    expect(without.eventPoints).toBe(0);
    expect(without.eventAwards).toEqual([]);
  });

  it("adds them in the year-to-date helper only when given", () => {
    expect(yearToDate([{ totalPoints: 200 }], true)).toBe(1700);
    expect(yearToDate([{ totalPoints: 200 }], true, 1700)).toBe(3400);
  });

  it("lists one row per club and event, with the event as the reason", () => {
    expect(eventAwardRows([withEvents, without])).toEqual([
      { clubId: "a", clubName: "Alpha Club", eventName: "Sample Leadership Weekend", points: 200 },
      { clubId: "a", clubName: "Alpha Club", eventName: "Sample Spring Camporee", points: 1500 },
    ]);
  });
});

describe("the exports", () => {
  it("adds an Event points column only when a club has event points", () => {
    expect(areaPointsCsv("2026-27", [withEvents, without]).split(/\r?\n/)[0]!.replaceAll('"', "")).toBe("Rank,Club,Sponsoring church,Club year,Report points,Yearly registration points,Event points,Total points");
    expect(areaPointsCsv("2026-27", [without]).split(/\r?\n/)[0]!.replaceAll('"', "")).toBe("Rank,Club,Sponsoring church,Club year,Report points,Yearly registration points,Total points");
    expect(areaSummaryCsv("2026-27", [withEvents]).split(/\r?\n/)[0]!.replaceAll('"', "")).toContain("Yearly registration points,Event points,Total points");
    expect(areaSummaryCsv("2026-27", [without]).split("\n")[0]).not.toContain("Event points");
  });
});

describe("the points views", () => {
  const sorting = serverSort("/account/area-clubs/points", {}, COORDINATOR_RANKING_SORT_COLUMNS, COORDINATOR_RANKING_DEFAULT_SORT, { firstDirection: rankingFirstDirection });

  it("shows an Event points column in the coordinator table once a club has some, and not before", () => {
    const html = renderToStaticMarkup(createElement(CoordinatorPointsRanking, { allClubs: [withEvents, without], clubYear: "2026-27", query: "", sorting }));
    expect(html).toContain("Event points");
    expect(html).toContain('data-label="Event points">1,700<');
    expect(html).toContain('data-label="Yearly registration" data-label-long="">1,500<');
    expect(html).toContain('data-label="Total points"');
    const plain = renderToStaticMarkup(createElement(CoordinatorPointsRanking, { allClubs: [without], clubYear: "2026-27", query: "", sorting }));
    expect(plain).not.toContain("Event points");
  });

  it("splits the staff bars into a third series and adds the table column only with event points", () => {
    const html = renderToStaticMarkup(createElement(PointsBars, { clubs: [withEvents, without], clubYear: "2026-27" }));
    expect(html).toContain("Event points");
    expect(html).toContain("Event points: 1,700");
    expect(html).toContain("report points, yearly registration points and event points");
    const plain = renderToStaticMarkup(createElement(PointsBars, { clubs: [without], clubYear: "2026-27" }));
    expect(plain).not.toContain("Event points");
  });

  it("lists event points by club and event, and draws nothing without any", () => {
    const html = renderToStaticMarkup(createElement(EventPointsByClub, { rows: eventAwardRows([withEvents]), clubYear: "2026-27" }));
    expect(html).toContain("Event points, 2026-27");
    expect(html).toContain('<span translate="no">Sample Spring Camporee</span>');
    expect(html).toContain('data-label="Points">1,500<');
    expect(renderToStaticMarkup(createElement(EventPointsByClub, { rows: [], clubYear: "2026-27" }))).toBe("");
  });

  it("shows a director their own club's event points with the event as the reason, and nothing without any", () => {
    const html = renderToStaticMarkup(createElement(ClubEventPointsList, { clubYear: "2026-27", eventPoints: { total: 1700, awards: withEvents.eventAwards } }));
    expect(html).toContain("Sample Spring Camporee");
    expect(html).toContain("1,500 points");
    expect(html).toContain("1,700 points in all");
    expect(renderToStaticMarkup(createElement(ClubEventPointsList, { clubYear: "2026-27", eventPoints: { total: 0, awards: [] } }))).toBe("");
  });
});
