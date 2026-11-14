import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1560: the events list adds a no-result search hit only when the visitor saw no events. */

const mocks = vi.hoisted(() => ({ items: vi.fn(), beacon: vi.fn(), hub: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-11-12", listPublicCalendarItems: mocks.items }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => ({ account: null, via: null, sessionId: null }) }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: async () => [] }));
vi.mock("@/modules/events/featured", () => ({ listFeaturedEventRows: async () => [] }));
vi.mock("@/modules/site-content/hub-content", () => ({ getPublishedHubContent: mocks.hub }));
vi.mock("@/components/public-header-session-links", () => ({ PublicHeaderSessionLinks: () => null }));
vi.mock("@/components/public-metrics-beacon", () => ({ PublicMetricsBeacon: (props: unknown) => { mocks.beacon(props); return null; } }));

import OpenForRegistrationPage from "@/app/(public)/events/page";
import { defaultHubContent } from "@/modules/site-content/hub-content-domain";

const camp = {
  key: "event-camp", kind: "EVENT", title: "Fictitious Camp Weekend", description: "", startsOn: "2026-11-20", endsOn: "2026-11-22", timeLabel: "",
  location: "Example Campground", category: "", href: "/events/camp", status: "SCHEDULED", registrationOpen: true, registrationStatus: "OPEN",
  registrationOpensOn: null, clubEvent: false,
};
const render = async (params: Record<string, string>) => renderToStaticMarkup(await OpenForRegistrationPage({ searchParams: Promise.resolve(params) }));
const hits = () => (mocks.beacon.mock.calls.at(-1)![0] as { hits: Array<{ metric: string; dimension?: string }> }).hits;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  mocks.hub.mockResolvedValue(defaultHubContent());
  mocks.items.mockResolvedValue([camp]);
});

describe("search with no results (#1560)", () => {
  it("adds the cleaned term next to the search hit when nothing matched", async () => {
    await render({ q: "  Zebra   Rodeo! " });
    expect(hits()).toEqual([{ metric: "DIRECTORY_SEARCH" }, { metric: "SEARCH_NO_RESULTS", dimension: "zebra rodeo" }]);
  });
  it("adds nothing when the search found an event", async () => {
    await render({ q: "camp" });
    expect(hits()).toEqual([{ metric: "DIRECTORY_SEARCH" }]);
  });
  it("adds nothing without a search, or for a term that cannot be kept", async () => {
    await render({ category: "Nothing" });
    expect(hits().map((hit) => hit.metric)).toEqual(["DIRECTORY_FILTER"]);
    await render({ q: "jane@example.org" });
    expect(hits()).toEqual([{ metric: "DIRECTORY_SEARCH" }]);
  });
});
