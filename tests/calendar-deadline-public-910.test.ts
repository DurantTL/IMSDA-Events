import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deadlines (#910) never reach the public calendar page's data, the subscribe feed (.ics), or the home page's
 * upcoming list: all three read `listPublicCalendarItems`, which the database query and an in-memory check both guard.
 * The real-database script (`npm run test:deadline-reminders`) proves the same against PostgreSQL.
 */
const mocks = vi.hoisted(() => ({ eventFindMany: vi.fn(), entryFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findMany: mocks.eventFindMany }, calendarEntry: { findMany: mocks.entryFindMany } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/calendar/subscribe", () => ({ siteBaseUrl: () => "https://events.example.test" }));

import { GET as getFeed } from "@/app/(public)/calendar/feed.ics/route";
import { listPublicCalendarItems } from "@/modules/calendar/repository";

const row = (id: string, title: string, entryType: string) => ({
  id, title, description: "", startsOn: "2026-12-05", endsOn: "2026-12-05", timeLabel: "", location: "", category: "", linkUrl: null,
  status: "SCHEDULED", entryType, repeatRule: null, repeatExceptions: [], isPublished: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  mocks.eventFindMany.mockResolvedValue([]);
  // Even if a Deadline slipped past the query, it must not come out.
  mocks.entryFindMany.mockResolvedValue([
    row("ordinary", "Fall Camporee", "STANDARD"),
    row("deadline", "Spring Camporee Registration Due", "DEADLINE"),
    row("closure", "Office closed", "CLOSURE"),
  ]);
});

describe("the public calendar", () => {
  it("lists ordinary entries and closures, never a deadline", async () => {
    const items = await listPublicCalendarItems("2026-11-01", "2026-12-31", new Date());
    expect(items.map((item) => item.title).sort()).toEqual(["Fall Camporee", "Office closed"]);
  });

  it("leaves a deadline out of the subscribe feed", async () => {
    const response = await getFeed(new Request("https://events.example.test/calendar/feed.ics"));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("SUMMARY:Fall Camporee");
    expect(body).toContain("SUMMARY:Office closed");
    expect(body).not.toContain("Registration Due");
    expect(body).not.toContain("entry-deadline");
    expect(mocks.entryFindMany.mock.calls[0][0].where).toMatchObject({ entryType: { not: "DEADLINE" } });
  });
});
