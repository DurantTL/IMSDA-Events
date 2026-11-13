import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FunnelBars, HorizontalBars, InlineFunnelBar, StatTiles, TrendChart, niceMax } from "@/components/analytics-charts";
import {
  analyticsPeriods,
  bucketSeries,
  changeVersusPrevious,
  describeChange,
  fillDailySeries,
  funnelRate,
  isWithinRetention,
  previousPeriodAvailable,
  previousPeriodRange,
  retentionDays,
  rateChangeVersusPrevious,
  topEventsByCompleted,
} from "@/modules/public-metrics/domain";
import { addDays } from "@/modules/calendar/domain";

/** Public analytics tiles and charts (#1961): the pure rules and the markup. Synthetic counts only; the clock is pinned. */
const TODAY = "2026-11-12";
const fromOf = (days: number) => addDays(TODAY, -(days - 1));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("previous period", () => {
  it.each([[30, "2026-09-14", "2026-10-13"], [90, "2026-05-17", "2026-08-14"]] as Array<[number, string, string]>)(
    "is the %i days right before the period",
    (days, from, to) => {
      const range = previousPeriodRange(fromOf(days), days);
      expect(range).toEqual({ from, to });
      expect(addDays(range.to, 1)).toBe(fromOf(days));
    },
  );

  it("has the same length as the period for every period", () => {
    for (const days of analyticsPeriods) {
      const range = previousPeriodRange(fromOf(days), days);
      expect(fillDailySeries(range.from, range.to, [])).toHaveLength(days);
    }
  });

  it("is compared for 30 and 90 days and never for 12 months (past the 400-day retention)", () => {
    expect(previousPeriodAvailable(TODAY, 30)).toBe(true);
    expect(previousPeriodAvailable(TODAY, 90)).toBe(true);
    expect(previousPeriodAvailable(TODAY, 365)).toBe(false);
  });

  it("needs every day of the previous period inside the window, not just some", () => {
    // 400 days back from today is the oldest kept day: a 30-day previous period that starts exactly there is whole.
    const oldest = addDays(TODAY, -400);
    expect(previousPeriodRange(addDays(oldest, 30), 30).from).toBe(oldest);
    expect(previousPeriodRange(addDays(oldest, 29), 30).from).toBe(addDays(oldest, -1));
  });
});

describe("change versus previous", () => {
  it("is up, down or the same with a whole percent", () => {
    expect(changeVersusPrevious(112, 100)).toEqual({ direction: "up", percent: 12 });
    expect(changeVersusPrevious(75, 100)).toEqual({ direction: "down", percent: 25 });
    expect(changeVersusPrevious(40, 40)).toEqual({ direction: "same", percent: 0 });
  });

  it("has no percent when the previous count was 0, and never a made-up +100%", () => {
    expect(changeVersusPrevious(5, 0)).toEqual({ direction: "up", percent: null });
    expect(changeVersusPrevious(0, 0)).toEqual({ direction: "same", percent: null });
  });

  it("reads a change that rounds to 0% as the same", () => {
    expect(changeVersusPrevious(1001, 1000)).toEqual({ direction: "same", percent: 0 });
  });

  it("measures a rate in percentage points, and is null when a rate is unknown", () => {
    expect(rateChangeVersusPrevious(0.5, 0.4)).toEqual({ direction: "up", points: 10 });
    expect(rateChangeVersusPrevious(0.25, 0.375)).toEqual({ direction: "down", points: 12.5 });
    expect(rateChangeVersusPrevious(0.3, 0.3)).toEqual({ direction: "same", points: 0 });
    expect(rateChangeVersusPrevious(null, 0.3)).toBeNull();
    expect(rateChangeVersusPrevious(0.3, funnelRate(0, 0))).toBeNull();
  });

  it("is written in words, not colour", () => {
    expect(describeChange({ direction: "up", percent: 12 }, "30 days")).toBe("Up 12% from the previous 30 days");
    expect(describeChange({ direction: "down", percent: 3 }, "90 days", 1200)).toBe("Down 3% from the previous 90 days (1,200)");
    expect(describeChange({ direction: "up", percent: null }, "30 days")).toBe("Up from none counted in the previous 30 days");
    expect(describeChange({ direction: "same", percent: 0 }, "30 days")).toBe("No change from the previous 30 days");
    expect(describeChange({ direction: "down", points: 2.5 }, "30 days")).toBe("Down 2.5 percentage points from the previous 30 days");
    expect(describeChange(null, "12 months")).toBe("No comparison: only part of the previous 12 months is still kept (counts are kept for 400 days).");
  });
});

describe("daily series", () => {
  const rows = [
    { day: "2026-11-10", metric: "EVENT_PAGE_VIEW", count: 10 },
    { day: "2026-11-10", metric: "REGISTRATION_START", count: 4 },
    { day: "2026-11-12", metric: "REGISTRATION_COMPLETE", count: 2 },
    { day: "2026-11-12", metric: "EVENT_PAGE_VIEW", count: 6 },
  ];

  it("has one point per day with missing days as 0", () => {
    const points = fillDailySeries("2026-11-09", TODAY, rows);
    expect(points.map((point) => point.day)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(points[0]).toEqual({ day: "2026-11-09", views: 0, started: 0, completed: 0 });
    expect(points[1]).toEqual({ day: "2026-11-10", views: 10, started: 4, completed: 0 });
    expect(points[2]).toEqual({ day: "2026-11-11", views: 0, started: 0, completed: 0 });
    expect(points[3]).toEqual({ day: "2026-11-12", views: 6, started: 0, completed: 2 });
  });

  it("ignores a metric that is not part of the funnel", () => {
    expect(fillDailySeries(TODAY, TODAY, [{ day: TODAY, metric: "NOT_FOUND", count: 9 }])[0]).toEqual({ day: TODAY, views: 0, started: 0, completed: 0 });
  });

  it("stays daily for 30 and 90 days", () => {
    for (const days of [30, 90]) {
      const points = fillDailySeries(fromOf(days), TODAY, []);
      expect(bucketSeries(points, days)).toHaveLength(days);
    }
  });

  it("is weekly for 365 days: whole weeks ending today, the odd day folded into the oldest week, no count lost", () => {
    const points = fillDailySeries(fromOf(365), TODAY, []).map((point, index) => ({ ...point, views: 1, started: index % 2, completed: 0 }));
    const buckets = bucketSeries(points, 365);
    expect(points).toHaveLength(365);
    expect(buckets).toHaveLength(52);
    expect(buckets[0]).toMatchObject({ start: fromOf(365), days: 8, views: 8 });
    expect(buckets[51]).toMatchObject({ end: TODAY, days: 7, views: 7 });
    expect(buckets.slice(1).every((bucket) => bucket.days === 7)).toBe(true);
    expect(buckets.every((bucket) => bucket.days >= 7)).toBe(true);
    expect(buckets.reduce((sum, bucket) => sum + bucket.views, 0)).toBe(365);
    expect(buckets.reduce((sum, bucket) => sum + bucket.started, 0)).toBe(points.reduce((sum, point) => sum + point.started, 0));
    expect(addDays(buckets[0]!.end, 1)).toBe(buckets[1]!.start);
  });
});

describe("the retention edge", () => {
  it("keeps the oldest day (today - 400) and drops the day before it", () => {
    expect(isWithinRetention(addDays(TODAY, -retentionDays), TODAY)).toBe(true);
    expect(isWithinRetention(addDays(TODAY, -retentionDays + 1), TODAY)).toBe(true);
    expect(isWithinRetention(addDays(TODAY, -retentionDays - 1), TODAY)).toBe(false);
  });

  it("compares a previous period that starts inside the window, and not one that starts past it", () => {
    // The previous period starts 2 * days - 1 days before today: 200 days starts at -399 (inside), 201 days at -401 (one day past).
    expect(previousPeriodRange(fromOf(200), 200).from).toBe(addDays(TODAY, -399));
    expect(previousPeriodAvailable(TODAY, 200)).toBe(true);
    expect(previousPeriodRange(fromOf(201), 201).from).toBe(addDays(TODAY, -401));
    expect(previousPeriodAvailable(TODAY, 201)).toBe(false);
  });
});

describe("top events", () => {
  const row = (slug: string, views: number, completed: number) => ({ slug, title: slug, views, started: completed, completed });

  it("keeps the ten with the most completed, most first, ties by views then slug, and drops events with none", () => {
    const rows = [...Array.from({ length: 12 }, (_, index) => row(`event-${String(index).padStart(2, "0")}`, 100, index + 1)), row("quiet", 500, 0), row("tie-b", 50, 12), row("tie-a", 50, 12)];
    const top = topEventsByCompleted(rows);
    expect(top).toHaveLength(10);
    expect(top.map((entry) => entry.slug).slice(0, 4)).toEqual(["event-11", "tie-a", "tie-b", "event-10"]);
    expect(top.some((entry) => entry.slug === "quiet")).toBe(false);
    expect(rows).toHaveLength(15);
  });

  it("is empty when nothing was completed", () => {
    expect(topEventsByCompleted([row("a", 10, 0)])).toEqual([]);
  });
});

describe("chart markup", () => {
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

  it("shows tiles with the change as an arrow and words", () => {
    const markup = html(createElement(StatTiles, { label: "Headline numbers", tiles: [{ label: "Event page views", value: "1,200", change: { direction: "up", text: "Up 12% from the previous 30 days" } }, { label: "Completed of started", value: "40%", change: { direction: "none", text: "No comparison: only part of the previous 12 months is still kept (counts are kept for 400 days)." } }] }));
    expect(markup).toContain("Up 12% from the previous 30 days");
    expect(markup).toContain("No comparison");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('aria-label="Headline numbers"');
  });

  it("gives the trend chart a text summary, three distinguishable series and a table", () => {
    const points = Array.from({ length: 30 }, (_, index) => ({ label: `Day ${index + 1}`, values: [index * 3, index, index % 5] }));
    const markup = html(createElement(TrendChart, { title: "Views, starts and completions by day", series: [{ key: "v", label: "Views" }, { key: "s", label: "Started" }, { key: "c", label: "Completed" }], points, summary: "Line chart summary text.", startLabel: "Oct 14, 2026", endLabel: "Nov 12, 2026" }));
    expect(markup).toContain("Line chart summary text.");
    expect(markup).toContain("<figcaption");
    expect(markup).toContain("Show as a table");
    expect(markup.match(/<polyline/g)).toHaveLength(3);
    expect(markup).toContain("stroke-dasharray=\"9 5\"");
    expect(markup).toContain("stroke-dasharray=\"2 5\"");
    expect(markup).toContain("<circle");
    expect(markup).toContain("<rect");
    expect(markup).toContain("<path");
    expect(markup).toContain("Vertical scale: 0 to 100");
    expect(markup).toContain("<th role=\"rowheader\" scope=\"row\">Day 30</th>");
    expect(markup).toContain('viewBox="0 0 360 200"');
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("scales the vertical axis to a round number, with 1 as the least", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(1000)).toBe(1000);
    expect(niceMax(4300)).toBe(5000);
  });

  it("writes funnel bars as numbers with a table and an empty message for a top list", () => {
    const funnel = html(createElement(FunnelBars, { title: "Funnel", summary: "Funnel summary.", steps: [{ label: "Page views", value: 200 }, { label: "Started", value: 50, note: "25% of page views" }] }));
    expect(funnel).toContain("25% of page views");
    expect(funnel).toContain("Funnel summary.");
    expect(funnel).toContain("Show as a table");
    const empty = html(createElement(HorizontalBars, { title: "Top events", valueLabel: "Completed", rows: [], summary: "None.", empty: "No registrations were completed in this period." }));
    expect(empty).toContain("No registrations were completed in this period.");
    expect(empty).not.toContain("Show as a table");
    const filled = html(createElement(HorizontalBars, { title: "Top events", valueLabel: "Completed", rows: [{ key: "a", label: "Camp Meeting", value: 30 }], summary: "One event.", empty: "" }));
    expect(filled).toContain("Camp Meeting");
    expect(filled).toContain("width:100%");
  });

  it("hides the inline funnel bar from assistive technology", () => {
    const markup = html(createElement(InlineFunnelBar, { views: 100, started: 50, completed: 120 }));
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("width:100%");
    expect(markup).toContain("width:41.666");
  });
});
