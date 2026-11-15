import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ items: vi.fn(), hub: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-11-12", listPublicCalendarItems: mocks.items }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => ({ account: null, via: null, sessionId: null }) }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: async () => [] }));
vi.mock("@/modules/events/featured", () => ({ listFeaturedEventRows: async () => [] }));
vi.mock("@/modules/site-content/hub-content", () => ({ getPublishedHubContent: mocks.hub }));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
vi.mock("@/components/public-metrics-beacon", () => ({ PublicMetricsBeacon: () => null, NoResultSearchBeacon: () => null }));

import OpenForRegistrationPage from "@/app/(public)/events/page";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";

const render = async (params: Record<string, string>) => renderToStaticMarkup(await OpenForRegistrationPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  mocks.hub.mockResolvedValue(defaultHubContent());
  mocks.items.mockResolvedValue([]);
});

describe("events list ended notice (#1514)", () => {
  it("shows a status notice for ?ended=1 without treating it as a filter", async () => {
    const html = await render({ ended: "1" });
    expect(html).toContain("That event has ended and is no longer open for registration.");
    expect(html).toMatch(/role="status"[^>]*>That event has ended/);
    expect(html).not.toContain("No events match these filters");
    expect(html).not.toContain('name="ended"');
  });
  it("shows no notice otherwise, and never echoes other values", async () => {
    expect(await render({})).not.toContain("has ended");
    expect(await render({ ended: "yes" })).not.toContain("has ended");
    expect(await render({ ended: "1", q: "" })).not.toContain("Clear filters");
  });
});
