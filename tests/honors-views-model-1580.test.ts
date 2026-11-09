import { describe, expect, it } from "vitest";
import { honorsViews } from "@/modules/honors/honors-views-model";

const labels = (views: ReturnType<typeof honorsViews>) => views.map((view) => view.label);

describe("honorsViews (#1580)", () => {
  it("gives a setup manager who can also view reports all four pages, in order, with ?event", () => {
    const views = honorsViews("ev 1", ["CONFIGURE_EVENT", "VIEW_REPORTS"], "schedule");
    expect(labels(views)).toEqual(["Classes", "Schedule board", "Instructors", "Rosters"]);
    expect(views.map((view) => view.href)).toEqual([
      "/more/honors?event=ev%201",
      "/more/honors/schedule?event=ev%201",
      "/more/honors/instructors?event=ev%201",
      "/more/honors/rosters?event=ev%201",
    ]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["schedule"]);
  });

  it("gives CONFIGURE_EVENT alone the three setup pages", () => {
    expect(labels(honorsViews("e", ["CONFIGURE_EVENT"]))).toEqual(["Classes", "Schedule board", "Instructors"]);
  });

  it("gives VIEW_REPORTS alone only Rosters, which a strip renders as nothing", () => {
    expect(labels(honorsViews("e", ["VIEW_REPORTS"], "rosters"))).toEqual(["Rosters"]);
  });

  it("gives other permissions nothing and marks no page current without one", () => {
    expect(honorsViews("e", ["VIEW_SENSITIVE_DATA"])).toEqual([]);
    expect(honorsViews("e", ["CONFIGURE_EVENT", "VIEW_REPORTS"]).some((view) => view.current)).toBe(false);
  });
});
