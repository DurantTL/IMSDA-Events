import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1560: the events list adds a no-result search hit only when the visitor saw no events. */

const mocks = vi.hoisted(() => ({ items: vi.fn(), beacon: vi.fn(), noResult: vi.fn(), hub: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-11-12", listPublicCalendarItems: mocks.items }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => ({ account: null, via: null, sessionId: null }) }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: async () => [] }));
vi.mock("@/modules/events/featured", () => ({ listFeaturedEventRows: async () => [] }));
vi.mock("@/modules/site-content/hub-content", () => ({ getPublishedHubContent: mocks.hub }));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
vi.mock("@/components/public-metrics-beacon", () => ({
  PublicMetricsBeacon: (props: unknown) => { mocks.beacon(props); return null; },
  NoResultSearchBeacon: (props: unknown) => { mocks.noResult(props); return null; },
}));

import OpenForRegistrationPage from "@/app/(public)/events/page";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";

const camp = {
  key: "event-camp", kind: "EVENT", title: "Fictitious Camp Weekend", description: "", startsOn: "2026-11-20", endsOn: "2026-11-22", timeLabel: "",
  location: "Example Campground", category: "", href: "/events/camp", status: "SCHEDULED", registrationOpen: true, registrationStatus: "OPEN",
  registrationOpensOn: null, clubEvent: false,
};
const render = async (params: Record<string, string>) => renderToStaticMarkup(await OpenForRegistrationPage({ searchParams: Promise.resolve(params) }));
const hits = () => (mocks.beacon.mock.calls.at(-1)![0] as { hits: Array<{ metric: string; dimension?: string }> }).hits;
const term = () => (mocks.noResult.mock.calls.at(-1)![0] as { term: string | null }).term;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  mocks.hub.mockResolvedValue(defaultHubContent());
  mocks.items.mockResolvedValue([camp]);
});

describe("search with no results (#1560)", () => {
  it("passes the cleaned term when the words match no open event, and keeps the search hit as it was", async () => {
    await render({ q: "  Zebra   Rodeo! " });
    expect(term()).toBe("zebra rodeo");
    expect(hits()).toEqual([{ metric: "DIRECTORY_SEARCH" }]);
  });
  it("passes nothing when the search found an event", async () => {
    await render({ q: "camp" });
    expect(term()).toBeNull();
  });
  it("passes nothing when a filter, not the words, emptied the list", async () => {
    await render({ q: "camp", category: "Nothing" });
    expect(term()).toBeNull();
    await render({ q: "camp", from: "2030-01-01" });
    expect(term()).toBeNull();
  });
  it("checks the words against every open event, not only the chosen audience tab", async () => {
    mocks.items.mockResolvedValue([camp, { ...camp, key: "event-camporee", title: "Fictitious Club Camporee", href: "/events/camporee", clubEvent: true }]);
    await render({ q: "camporee", for: "everyone" });
    expect(term()).toBeNull();
    await render({ q: "zebra rodeo", for: "everyone" });
    expect(term()).toBe("zebra rodeo");
  });
  it("passes nothing when there are no open events at all", async () => {
    mocks.items.mockResolvedValue([]);
    await render({ q: "zebra rodeo" });
    expect(term()).toBeNull();
  });
  it("passes nothing without a search or for a term that cannot be kept", async () => {
    await render({ category: "Nothing" });
    expect(term()).toBeNull();
    await render({ q: "jane@example.org" });
    expect(term()).toBeNull();
  });
});
