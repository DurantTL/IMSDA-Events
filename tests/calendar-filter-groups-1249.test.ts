import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CalendarSubscribe } from "@/components/calendar-subscribe";
import { CalendarViewBar } from "@/components/calendar-view-bar";
import { calendarGridRows, calendarMoreLabel, monthGrid, weekBarLayout, type CalendarItem } from "@/modules/calendar/domain";
import {
  calendarFilterGroups,
  defaultCalendarFilter,
  filterByGroup,
  resolveCalendarFilter,
} from "@/modules/calendar/filter-groups";

const item = (key: string, category: string, overrides: Partial<CalendarItem> = {}): CalendarItem =>
  ({
    key, kind: "ENTRY", title: `Synthetic ${key}`, description: "", startsOn: "2026-03-04", endsOn: "2026-03-04", timeLabel: "", location: "",
    category, href: null, status: "SCHEDULED", registrationOpen: false, ...overrides,
  }) as CalendarItem;

const everyItem = [
  item("pf", "Pathfinders"),
  item("ad", "ADVENTURERS"),
  item("camp", "Camps"),
  item("min", "Ministries"),
  item("school", "Schools"),
  item("meet", "Meetings"),
  item("closed", "Office closure", { isClosure: true }),
  item("holiday", "Holidays"),
  item("other", "Something new"),
  item("plain-event", "", { kind: "EVENT" }),
  item("club-event", "", { kind: "EVENT", clubEvent: true }),
  item("club-flag-on-entry", "Youth", { clubEvent: true }),
];
const keys = (slug: string) => filterByGroup(everyItem, slug).map((entry) => entry.key);

describe("calendar filter groups (#1249)", () => {
  it("lists the chips in order, with Main events as the default", () => {
    expect(calendarFilterGroups.map((group) => group.label)).toEqual([
      "Main events", "Club events", "Pathfinders", "Adventurers", "Camps", "Ministries", "Schools", "Meetings", "Office closed & holidays", "Everything",
    ]);
    expect(defaultCalendarFilter).toBe("main");
    expect(new Set(calendarFilterGroups.map((group) => group.slug)).size).toBe(calendarFilterGroups.length);
  });

  it("makes Main events everything except Schools, Meetings and closures and holidays", () => {
    expect(keys("main")).toEqual(["pf", "ad", "camp", "min", "other", "plain-event", "club-event", "club-flag-on-entry"]);
  });

  it("makes Club events Pathfinders and Adventurers (any case) plus registration events for clubs only", () => {
    expect(keys("club")).toEqual(["pf", "ad", "club-event"]);
  });

  it("gives each single-category chip exactly its own category", () => {
    expect(keys("pathfinders")).toEqual(["pf"]);
    expect(keys("adventurers")).toEqual(["ad"]);
    expect(keys("camps")).toEqual(["camp"]);
    expect(keys("ministries")).toEqual(["min"]);
    expect(keys("schools")).toEqual(["school"]);
    expect(keys("meetings")).toEqual(["meet"]);
    expect(keys("closed")).toEqual(["closed", "holiday"]);
  });

  it("shows a category in no group only under Main events and Everything", () => {
    const inGroups = calendarFilterGroups.filter((group) => keys(group.slug).includes("other")).map((group) => group.slug);
    expect(inGroups).toEqual(["main", "everything"]);
  });

  it("returns every item for Everything and falls back to Main events for an unknown slug", () => {
    expect(keys("everything")).toHaveLength(everyItem.length);
    expect(keys("nonsense")).toEqual(keys("main"));
  });

  it("resolves the URL: a filter wins, an old category link maps sensibly, and no param is the default", () => {
    expect(resolveCalendarFilter(undefined, undefined)).toEqual({ slug: "main" });
    expect(resolveCalendarFilter("club", undefined)).toEqual({ slug: "club" });
    expect(resolveCalendarFilter("club", "Camps")).toEqual({ slug: "club" });
    expect(resolveCalendarFilter("bogus", undefined)).toEqual({ slug: "main" });
    expect(resolveCalendarFilter(undefined, "camps")).toEqual({ slug: "camps" });
    expect(resolveCalendarFilter(undefined, "Office closure")).toEqual({ slug: "closed" });
    expect(resolveCalendarFilter(undefined, "Youth")).toEqual({ slug: "everything", category: "Youth" });
  });
});

describe("month grid '+N more' (#1249)", () => {
  const week = monthGrid({ year: 2026, month: 3 })[0];
  const day = (count: number) => Array.from({ length: count }, (_, index) => item(`d${index}`, "Youth", { startsOn: "2026-03-02", endsOn: "2026-03-02" }));

  it("shows two rows and counts the rest on the day", () => {
    expect(calendarGridRows).toBe(2);
    expect(weekBarLayout(week, day(2), calendarGridRows).hiddenByDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const three = weekBarLayout(week, day(3), calendarGridRows);
    expect(three.bars).toHaveLength(2);
    expect(three.hiddenByDay).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(weekBarLayout(week, day(8), calendarGridRows).hiddenByDay[1]).toBe(6);
  });

  it("counts a hidden multi-day item on every day it covers and words the link", () => {
    const rows = [item("a", "Youth", { startsOn: "2026-03-02", endsOn: "2026-03-04" }), item("b", "Youth", { startsOn: "2026-03-02", endsOn: "2026-03-04" })];
    const { hiddenByDay } = weekBarLayout(week, [...rows, item("c", "Youth", { startsOn: "2026-03-03", endsOn: "2026-03-03" })], calendarGridRows);
    expect(hiddenByDay).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(calendarMoreLabel(3)).toBe("+3 more");
  });
});

describe("sticky view bar and compact subscribe (#1249)", () => {
  it("renders every tab it is given, so a Year tab is one more entry", () => {
    const markup = renderToStaticMarkup(createElement(CalendarViewBar, {
      tabs: [{ key: "month", label: "Month", href: "/calendar" }, { key: "list", label: "Upcoming", href: "/calendar?view=list" }, { key: "year", label: "Year", href: "/calendar?view=year" }],
      currentView: "year",
      chips: calendarFilterGroups.map((group) => ({ slug: group.slug, label: group.label, href: `/calendar?filter=${group.slug}` })),
      activeFilter: "club",
    }));
    expect(markup).toContain('aria-current="page" href="/calendar?view=year">');
    expect(markup).toMatch(/Year<\/a>/);
    expect(markup).toContain('aria-current="page" href="/calendar?filter=club">Club events');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("calendar-month-nav");
  });

  it("opens the same subscribe choices from one header button", () => {
    const links = { google: "https://g.test/x", outlook: "https://o.test/x", outlookWork: "https://w.test/x", apple: "webcal://a.test/x", webcalUrl: "webcal://a.test/x", feedUrl: "https://a.test/x.ics" };
    const markup = renderToStaticMarkup(createElement(CalendarSubscribe, { links, variant: "button" }));
    expect(markup).toContain("Add to my calendar");
    expect(markup).toContain('aria-expanded="false"');
    for (const label of ["Google Calendar", "Outlook.com", "Outlook (work or school)", "Apple Calendar", "ICS link", "Copy link"]) expect(markup).toContain(label);
    expect(markup).not.toContain("<h2");
  });
});
