import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPublicCalendarItems: vi.fn(),
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  headerState: { staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: false },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/calendar/repository", () => ({
  conferenceToday: () => "2026-09-23",
  listPublicCalendarItems: mocks.listPublicCalendarItems,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
// An async server component cannot render inside renderToStaticMarkup, so this stands in for it with the same presentational links (#1009).
vi.mock("@/components/public-header-session-links", async () => {
  const { createElement } = await import("react");
  const { PublicHeaderLinks } = await import("@/components/public-header-links");
  return { PublicHeaderSessionLinks: () => createElement(PublicHeaderLinks, mocks.headerState) };
});
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));

import Home from "@/app/page";

const item = (n: number) => ({
  key: `event-${n}`,
  kind: "EVENT",
  title: `Fictitious Camp ${n}`,
  startsOn: `2026-10-${String(n).padStart(2, "0")}`,
  endsOn: `2026-10-${String(n).padStart(2, "0")}`,
  timeLabel: "",
  location: "Example Campground",
  description: "",
  category: "Youth",
  status: "SCHEDULED",
  href: `/events/camp-${n}`,
  registrationOpen: true,
});

async function render() {
  return renderToStaticMarkup(await Home());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPublicCalendarItems.mockResolvedValue([]);
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.headerState = { staffSignedIn: false, attendeeSignedIn: false, unifiedSignInEnabled: false };
});

describe("public front page (#373)", () => {
  it("is public: account, club, and calendar, with no link to staff sign-in", async () => {
    const html = await render();
    expect(html).toContain('href="/account"');
    expect(html).toContain('href="/account/clubs"');
    expect(html).toContain('href="/calendar"');
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/overview"');
    expect(html).toContain("Nothing is on the calendar yet");
  });

  it("shows a Sign in link to a signed-out visitor, to /sign-in only when single sign-in is on (#1009)", async () => {
    const off = await render();
    expect(off).toContain('href="/account/sign-in"');
    expect(off).not.toContain('href="/sign-in"');
    mocks.headerState = { ...mocks.headerState, unifiedSignInEnabled: true };
    const on = await render();
    expect(on).toContain('href="/sign-in"');
  });

  it("lists the next six public calendar items from today", async () => {
    mocks.listPublicCalendarItems.mockResolvedValue(Array.from({ length: 8 }, (_, i) => item(i + 1)));
    const html = await render();
    expect(mocks.listPublicCalendarItems).toHaveBeenCalledWith("2026-09-23", expect.any(String));
    expect(html).toContain("Fictitious Camp 6");
    expect(html).not.toContain("Fictitious Camp 7");
    expect(html).toContain("See the full calendar");
  });

  it("offers the staff workspace to a signed-in staff member", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.headerState = { staffSignedIn: true, attendeeSignedIn: false, unifiedSignInEnabled: false };
    const html = await render();
    expect(html).toContain('href="/overview"');
    expect(html).not.toContain('href="/login"');
  });

  it("greets a signed-in attendee", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({
      account: { id: "acct-1", verifiedEmail: "parent@example.test", displayName: "Pat Example" },
      via: "attendee",
      sessionId: "s-1",
    });
    const html = await render();
    expect(html).toContain("Go to my account");
    expect(html).toContain("Signed in as Pat Example");
  });
});
