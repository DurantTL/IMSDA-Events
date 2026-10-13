import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "Upcoming deadlines" list (#910): what is loaded for the club portal and the Area Coordinator view, in the
 * conference time zone, and how it reads on the page.
 */
const mocks = vi.hoisted(() => ({ entryFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ calendarEntry: { findMany: mocks.entryFindMany } }) }));

import { UpcomingDeadlines } from "@/components/upcoming-deadlines";
import { listUpcomingDeadlines } from "@/modules/calendar/deadline-list";

const entry = (patch: Record<string, unknown> = {}) => ({
  id: "e1", title: "Spring Camporee Registration Due", startsOn: "2026-10-22", endsOn: "2026-10-22", linkUrl: null, status: "SCHEDULED",
  repeatRule: null, repeatExceptions: [], ...patch,
});

// 03:00Z on Oct 13 is still Oct 12 in Chicago (CDT, UTC-5).
const now = new Date("2026-10-13T03:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entryFindMany.mockResolvedValue([]);
});

describe("which deadlines are loaded", () => {
  it("asks only for published, visible, uncancelled Deadline entries, from 7 days back to 90 days ahead in conference dates", async () => {
    await listUpcomingDeadlines(now);
    expect(mocks.entryFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.entryFindMany.mock.calls[0][0].where).toMatchObject({
      entryType: "DEADLINE",
      isPublished: true,
      isHiddenLocally: false,
      sourceRemovedAt: null,
      status: { not: "CANCELLED" },
      startsOn: { lte: "2027-01-10" }, // Oct 12 + 90 days
      OR: [{ endsOn: { gte: "2026-10-05" } }, { repeatRule: { not: null } }], // Oct 12 - 7 days
    });
  });

  it("lists in date order with how soon each is due, marking recently passed ones overdue", async () => {
    mocks.entryFindMany.mockResolvedValue([
      entry({ id: "later", title: "Reports Due", startsOn: "2026-11-01", endsOn: "2026-11-01", linkUrl: "https://example.test/reports" }),
      entry({ id: "passed", title: "Nominations Due", startsOn: "2026-10-09", endsOn: "2026-10-09" }),
      entry({ id: "soon", title: "Registration Due", startsOn: "2026-10-12", endsOn: "2026-10-12" }),
      entry({ id: "far", title: "Next year", startsOn: "2027-03-01", endsOn: "2027-03-01" }),
      entry({ id: "ancient", title: "Last month", startsOn: "2026-09-01", endsOn: "2026-09-01" }),
    ]);
    const items = await listUpcomingDeadlines(now);
    expect(items.map((item) => `${item.dueOn} ${item.title} | ${item.label}`)).toEqual([
      "2026-10-09 Nominations Due | 3 days overdue",
      "2026-10-12 Registration Due | Due today",
      "2026-11-01 Reports Due | Due in 20 days",
    ]);
    expect(items[0].overdue).toBe(true);
    expect(items[2]).toMatchObject({ overdue: false, href: "https://example.test/reports" });
  });

  it("uses the conference date, not the UTC date, around midnight", async () => {
    mocks.entryFindMany.mockResolvedValue([entry({ startsOn: "2026-10-13", endsOn: "2026-10-13" })]);
    // 04:59Z on Oct 13 is Oct 12, 11:59 PM in Chicago: due tomorrow. 05:00Z is Oct 13: due today.
    expect((await listUpcomingDeadlines(new Date("2026-10-13T04:59:00Z")))[0].label).toBe("Due tomorrow");
    expect((await listUpcomingDeadlines(new Date("2026-10-13T05:00:00Z")))[0].label).toBe("Due today");
  });

  it("uses the last day of a multi-day item as its due date, and lists a repeating deadline's occurrences in the window", async () => {
    mocks.entryFindMany.mockResolvedValue([
      entry({ id: "span", title: "Window closes", startsOn: "2026-10-20", endsOn: "2026-10-24" }),
      entry({ id: "monthly", title: "Monthly report due", startsOn: "2026-07-10", endsOn: "2026-07-10", repeatRule: "FREQ=MONTHLY" }),
    ]);
    const items = await listUpcomingDeadlines(now);
    expect(items.map((item) => `${item.dueOn} ${item.title}`)).toEqual([
      "2026-10-10 Monthly report due",
      "2026-10-24 Window closes",
      "2026-11-10 Monthly report due",
      "2026-12-10 Monthly report due",
      "2027-01-10 Monthly report due",
    ]);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("shows a postponed deadline as postponed", async () => {
    mocks.entryFindMany.mockResolvedValue([entry({ status: "POSTPONED" })]);
    expect((await listUpcomingDeadlines(now))[0].postponed).toBe(true);
  });
});

describe("how the list reads", () => {
  const item = (patch: Record<string, unknown> = {}) => ({
    key: "k", title: "Spring Camporee Registration Due", dueOn: "2026-10-22", href: null, postponed: false, label: "Due in 10 days", overdue: false, ...patch,
  });

  it("shows the title, the date, how soon, and a link only when there is a safe one", () => {
    const html = renderToStaticMarkup(UpcomingDeadlines({ deadlines: [
      item({ href: "https://example.test/register" }),
      item({ key: "k2", title: "Unsafe link", href: "javascript:alert(1)" }),
    ] }));
    expect(html).toContain("Upcoming deadlines");
    expect(html).toContain("Spring Camporee Registration Due");
    expect(html).toContain("October 22, 2026");
    expect(html).toContain("Due in 10 days");
    expect(html).toContain('href="https://example.test/register"');
    expect(html.match(/club-event-action/g)).toHaveLength(1);
    expect(html).not.toContain("javascript:");
  });

  it("marks an overdue deadline", () => {
    const html = renderToStaticMarkup(UpcomingDeadlines({ deadlines: [item({ overdue: true, label: "2 days overdue", dueOn: "2026-10-10" })] }));
    expect(html).toContain("club-step-danger");
    expect(html).toContain("2 days overdue");
  });

  it("says so when nothing is due", () => {
    expect(renderToStaticMarkup(UpcomingDeadlines({ deadlines: [] }))).toContain("No deadlines in the next 90 days.");
  });
});
