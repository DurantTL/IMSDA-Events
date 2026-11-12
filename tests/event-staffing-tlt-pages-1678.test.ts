import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  grantFindUnique: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  eventFindFirst: vi.fn(),
  moduleFindUnique: vi.fn(),
  loadStaffingSheet: vi.fn(),
  listEventTlts: vi.fn(),
  listTltStaffingEvents: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.grantFindUnique }, event: { findFirst: mocks.eventFindFirst }, eventModule: { findUnique: mocks.moduleFindUnique } }) }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee, findSwitchableAttendeeAccountForStaff: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/tlt-staffing", () => ({ TltStaffing: () => null }));
vi.mock("@/components/coordinator-section-heading", () => ({ CoordinatorSectionHeading: () => null }));
vi.mock("@/components/navigation-link", () => ({ NavigationLink: () => null }));
vi.mock("@/modules/event-staffing/repository", () => ({ loadStaffingSheet: mocks.loadStaffingSheet }));
vi.mock("@/modules/event-staffing/tlt-director", () => ({ listEventTlts: mocks.listEventTlts, listTltStaffingEvents: mocks.listTltStaffingEvents }));

import EventPage from "@/app/(public)/account/(portal)/area-clubs/tlt/staffing/[eventId]/page";
import OverviewPage from "@/app/(public)/account/(portal)/area-clubs/tlt/staffing/page";

/** The TLT director's two staffing pages answer "not found" to everyone else, and read nothing for them (#1678). */

const attendee = { account: { id: "account-1" }, via: "attendee", sessionId: "s1" };
const grant = { revokedAt: null, expiresAt: null, tltDirector: true };
const params = Promise.resolve({ eventId: "event-1" });

const notDirector: Record<string, () => void> = {
  "an ordinary Area Coordinator": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grant, tltDirector: false }); },
  "a club director or other attendee": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(null); },
  "staff acting as an Area Coordinator": () => { mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); },
  "a TLT director without the second step": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(grant); mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY"); },
  "an Area Coordinator whose role was removed": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grant, revokedAt: new Date("2026-11-01T00:00:00Z") }); },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Spring Camporee" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
  mocks.loadStaffingSheet.mockResolvedValue([]);
  mocks.listEventTlts.mockResolvedValue([]);
  mocks.listTltStaffingEvents.mockResolvedValue([]);
});

describe("the TLT staffing pages (#1678)", () => {
  it.each(Object.entries(notDirector))("answer not found for %s, without reading a sheet or a TLT", async (_who, setup) => {
    setup();
    await expect(OverviewPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(EventPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.listTltStaffingEvents).not.toHaveBeenCalled();
    expect(mocks.loadStaffingSheet).not.toHaveBeenCalled();
    expect(mocks.listEventTlts).not.toHaveBeenCalled();
  });

  it("show the TLT director the events and one event's sheet", async () => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.grantFindUnique.mockResolvedValue(grant);
    await expect(OverviewPage()).resolves.toBeTruthy();
    await expect(EventPage({ params, searchParams: Promise.resolve({ tag: "tag-1", year: "9" }) })).resolves.toBeTruthy();
    expect(mocks.loadStaffingSheet).toHaveBeenCalledWith("event-1");
  });

  it("answers not found to the director for an event with the sheet off, or one that is not a published club event", async () => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.grantFindUnique.mockResolvedValue(grant);
    mocks.moduleFindUnique.mockResolvedValue(null);
    await expect(EventPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
    mocks.eventFindFirst.mockResolvedValue(null);
    await expect(EventPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadStaffingSheet).not.toHaveBeenCalled();
  });
});

describe("the TLT staffing picker's own rules (#1678)", () => {
  const source = readFileSync("components/tlt-staffing.tsx", "utf8");
  const css = readFileSync("components/tlt-staffing.module.css", "utf8");

  it("shows Saving only on the card being saved, and drops a filter id the event has no option for", () => {
    expect(source).toContain('savingId === option.personId ? "Saving…" : "Assign"');
    expect(source).not.toMatch(/busy \? "Saving…" : "Assign"/);
    expect(source).toContain("tags.some((entry) => entry.id === filters.tag)");
    expect(source).toContain("clubs.some((entry) => entry.id === filters.club)");
  });

  it("marks both Clear filters links as same-page, and styles the empty-state link as a link", () => {
    expect(source.match(/data-same-page/g)).toHaveLength(2);
    expect(css).toMatch(/\.empty a \{[^}]*color: var\(--imsda-purple\)[^}]*text-decoration: underline/);
  });
});
