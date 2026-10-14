import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  getCurrentSession: vi.fn(),
  getAttendeeEventHub: vi.fn(),
  getEventHubTitleForViewer: vi.fn(),
  getStaffEventHubPreview: vi.fn(),
  getAttendeeCommunity: vi.fn(),
  getStaffCommunity: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({
  requireAttendeeSecondStep: vi.fn(),
  attendeeSecondStepPending: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ attendeeSignInRedirectPath: vi.fn() }));
vi.mock("@/modules/attendee-accounts/event-hub-repository", () => ({
  getAttendeeEventHub: mocks.getAttendeeEventHub,
  getEventHubTitleForViewer: mocks.getEventHubTitleForViewer,
  getStaffEventHubPreview: mocks.getStaffEventHubPreview,
}));
vi.mock("@/modules/community/repository", () => ({
  getAttendeeCommunity: mocks.getAttendeeCommunity,
  getStaffCommunity: mocks.getStaffCommunity,
}));

import AttendeeEventHubPage, { generateMetadata } from "@/app/(public)/account/events/[eventSlug]/page";

function hub(copy: { hubTitle: string | null; hubIntro: string | null }) {
  return {
    event: {
      slug: "synthetic-weekend", name: "Synthetic Weekend",
      startsAt: "2026-10-09T21:00:00.000Z", endsAt: "2026-10-11T17:00:00.000Z",
      timezone: "America/Chicago", location: "Synthetic Lodge", supportContact: null,
      ...copy,
    },
    announcements: [], contentSections: [], registrations: [], assignmentRuns: [],
  };
}

async function render(copy: { hubTitle: string | null; hubIntro: string | null }) {
  mocks.getAttendeeEventHub.mockResolvedValue(hub(copy));
  const element = await AttendeeEventHubPage({
    params: Promise.resolve({ eventSlug: "synthetic-weekend" }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1", verifiedEmail: "guest@example.test" } });
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getAttendeeCommunity.mockResolvedValue(null);
});

describe("hub page copy (#104)", () => {
  it("renders the event's own eyebrow and intro", async () => {
    const html = await render({ hubTitle: "Weekend guide", hubIntro: "Everything for the weekend." });
    expect(html).toContain("Weekend guide");
    expect(html).toContain("Everything for the weekend.");
    expect(html).not.toContain("Your attendee hub");
    expect(html).not.toContain("in one signed-in place");
  });

  it("renders the defaults when unset", async () => {
    const html = await render({ hubTitle: null, hubIntro: null });
    expect(html).toContain("Your attendee hub");
    expect(html).toContain("Schedule, updates, resources, passes and assigned sessions in one signed-in place.");
  });
});

describe("hub page metadata (#104)", () => {
  it("uses the viewer-scoped title and falls back to the default", async () => {
    mocks.getEventHubTitleForViewer.mockResolvedValue("Weekend guide");
    const params = Promise.resolve({ eventSlug: "synthetic-weekend" });
    expect((await generateMetadata({ params, searchParams: Promise.resolve({}) })).title).toBe("Weekend guide");
    expect(mocks.getEventHubTitleForViewer).toHaveBeenCalledWith({
      eventSlug: "synthetic-weekend", attendeeEmail: "guest@example.test",
    });

    mocks.getEventHubTitleForViewer.mockResolvedValue(null);
    expect((await generateMetadata({ params, searchParams: Promise.resolve({}) })).title).toBe("Event hub");
  });

  it("does not look the title up at all for a signed-out visitor", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null });
    const metadata = await generateMetadata({
      params: Promise.resolve({ eventSlug: "synthetic-weekend" }),
      searchParams: Promise.resolve({}),
    });
    expect(metadata.title).toBe("Event hub");
    expect(mocks.getEventHubTitleForViewer).not.toHaveBeenCalled();
  });
});
