import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPublicEventLanding: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/public-repository", () => ({ getPublicEventLanding: mocks.getPublicEventLanding }));
vi.mock("@/modules/calendar/subscribe", () => ({ siteBaseUrl: () => "https://events.example.test" }));

import { GET } from "@/app/(public)/events/[eventSlug]/event.ics/route";

const call = (slug: string) => GET(new Request(`https://events.example.test/events/${slug}/event.ics`), { params: Promise.resolve({ eventSlug: slug }) } as never);

beforeEach(() => vi.clearAllMocks());

describe("Add to my calendar for one event (#1205)", () => {
  it("serves one all-day iCalendar entry for a public event", async () => {
    mocks.getPublicEventLanding.mockResolvedValue({
      event: { slug: "synthetic-retreat", name: "Synthetic Retreat", startsAt: "2027-02-05T15:00:00.000Z", endsAt: "2027-02-07T18:00:00.000Z", timezone: "America/Chicago", location: "Synthetic Camp", timeLabel: "Fri 9:00 AM – Sun 12:00 PM CST" },
    });
    const response = await call("synthetic-retreat");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    const body = await response.text();
    expect(body).toContain("SUMMARY:Synthetic Retreat");
    expect(body).toContain("DTSTART;VALUE=DATE:20270205");
    expect(body).toContain("DTEND;VALUE=DATE:20270208");
    expect(body).toContain("URL:https://events.example.test/events/synthetic-retreat");
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  // getPublicEventLanding only finds published, unarchived events and answers null for anything else.
  it.each(["unknown-slug", "unpublished-slug", "archived-slug"])("answers 404 for %s", async (slug) => {
    mocks.getPublicEventLanding.mockResolvedValue(null);
    const response = await call(slug);
    expect(response.status).toBe(404);
    expect(mocks.getPublicEventLanding).toHaveBeenCalledWith(slug);
  });
});
