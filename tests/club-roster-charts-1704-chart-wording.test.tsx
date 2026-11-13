import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HorizontalBars, TrendChart } from "@/components/analytics-charts";

/** The chart table wording defaults are unchanged for the admin analytics page (#1704). */
describe("chart table wording", () => {
  const rows = [{ key: "a", label: "Alpha", value: 2 }];
  it("keeps the defaults", () => {
    const bars = renderToStaticMarkup(<HorizontalBars empty="none" rows={rows} summary="s" title="Top" valueLabel="Views" />);
    expect(bars).toContain("Top, most first");
    expect(bars).toContain(">Event<");
    const trend = renderToStaticMarkup(<TrendChart endLabel="e" points={[{ label: "x", values: [1] }]} series={[{ key: "k", label: "K" }]} startLabel="s" summary="s" title="T" />);
    expect(trend).toContain("T: counts for each date or week");
    expect(trend).toContain(">Date<");
  });
  it("takes the new wording", () => {
    const bars = renderToStaticMarkup(<HorizontalBars empty="none" nameLabel="Class" order=", in class order" rows={rows} summary="s" title="Top" valueLabel="People" />);
    expect(bars).toContain("Top, in class order");
    expect(bars).toContain(">Class<");
    const trend = renderToStaticMarkup(<TrendChart endLabel="e" pointLabel="Month" points={[{ label: "x", values: [1] }]} series={[{ key: "k", label: "K" }]} startLabel="s" summary="s" tableNote="counts for each month" title="T" />);
    expect(trend).toContain("T: counts for each month");
    expect(trend).toContain(">Month<");
  });
});
