import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can see and change the club calendar (#1700): director, deputy, registrar, reporter, another club's director, an
 * Area Coordinator and staff (with and without an act-as), through the real club access check and the real repository.
 * Only sign-in, directory, conference calendar and database lookups are mocked. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  rateLimit: vi.fn(),
  listPublicCalendarItems: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn() },
    clubCalendarItem: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
    clubCalendarReminderSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  writeAuditLog: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/rate-limit/service", () => ({ checkClubCalendarRateLimit: mocks.rateLimit }));
vi.mock("@/modules/calendar/repository", () => ({ listPublicCalendarItems: mocks.listPublicCalendarItems }));

import ClubCalendarPage, { metadata } from "@/app/(public)/account/(portal)/clubs/[organizationId]/calendar/page";
import { POST } from "@/app/api/attendee/clubs/[organizationId]/calendar/route";
import { DELETE, PATCH } from "@/app/api/attendee/clubs/[organizationId]/calendar/[itemId]/route";
import { PUT } from "@/app/api/attendee/clubs/[organizationId]/calendar/reminders/route";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({} as { month?: string }) };
const itemParams = { params: Promise.resolve({ organizationId: "club-1", itemId: "item-1" }) };
const orgParams = { params: Promise.resolve({ organizationId: "club-1" }) };
const url = "https://events.imsda.test/api/attendee/clubs/club-1/calendar";
const json = (method: string, body: unknown, path = "") => new Request(`${url}${path}`, {
  method,
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const goodItem = { kind: "MEETING", title: "Weekly meeting", date: "2026-11-18", startTime: "18:30", endTime: "20:00", location: "Fellowship hall", notes: "Private note" };

function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
}

function actingAsDirector(organizationId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId, userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
}

const html = async (arg = params) => renderToStaticMarkup((await ClubCalendarPage(arg)) as ReactElement);
const nothingWritten = () => {
  expect(mocks.prisma.clubCalendarItem.create).not.toHaveBeenCalled();
  expect(mocks.prisma.clubCalendarItem.updateMany).not.toHaveBeenCalled();
  expect(mocks.prisma.clubCalendarItem.deleteMany).not.toHaveBeenCalled();
  expect(mocks.prisma.clubCalendarReminderSetting.upsert).not.toHaveBeenCalled();
  expect(mocks.writeAuditLog).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T18:00:00.000Z"));
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.prisma.clubCalendarItem.findMany.mockResolvedValue([
    { id: "item-1", kind: "MEETING", title: "Weekly meeting", date: "2026-11-18", startTime: "18:30", endTime: "20:00", location: "Fellowship hall", notes: "Private note" },
    { id: "item-2", kind: "OUTING", title: "Canoe trip", date: "2026-11-21", startTime: null, endTime: null, location: null, notes: null },
  ]);
  mocks.prisma.clubCalendarItem.create.mockResolvedValue({ id: "item-9", kind: "MEETING" });
  mocks.prisma.clubCalendarItem.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubCalendarItem.findFirst.mockResolvedValue({ id: "item-1", kind: "MEETING" });
  mocks.prisma.clubCalendarItem.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubCalendarReminderSetting.findUnique.mockResolvedValue(null);
  mocks.listPublicCalendarItems.mockResolvedValue([
    { key: "event-1", kind: "EVENT", title: "Synthetic Camporee", description: "", startsOn: "2026-11-20", endsOn: "2026-11-22", timeLabel: "", location: "Synthetic Camp", category: "", href: "/events/synthetic-camporee", status: "SCHEDULED", registrationOpen: false },
  ]);
});

describe("the calendar page", () => {
  it("is named Club calendar", () => {
    expect(metadata.title).toBe("Club calendar");
  });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows a club %s the agenda, the add form and the reminder settings", async (role) => {
    signedInAs(role);
    const page = await html();
    expect(page).toContain("Weekly meeting");
    expect(page).toContain("Canoe trip");
    expect(page).toContain("Synthetic Camporee");
    expect(page).toContain("Add a meeting, outing or deadline");
    expect(page).toContain("Reminder emails");
    expect(page).toContain("Edit");
    expect(page).toContain("Delete");
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("lets a club %s view the agenda only, with no way to change anything and no reminder setting", async (role) => {
    signedInAs(role);
    const page = await html();
    expect(page).toContain("Weekly meeting");
    expect(page).toContain("Synthetic Camporee");
    expect(page).not.toContain("Add a meeting, outing or deadline");
    expect(page).not.toContain("Reminder emails");
    expect(page).not.toMatch(/>\s*Edit/);
    expect(page).not.toContain("Delete");
    // Viewers are never asked for the reminder setting at all.
    expect(mocks.prisma.clubCalendarReminderSetting.findUnique).not.toHaveBeenCalled();
  });

  it("says in words whether each entry is the club's or the conference's, not by colour alone", async () => {
    signedInAs("DIRECTOR");
    const page = await html();
    expect(page).toContain("Club meeting");
    expect(page).toContain("Club outing");
    expect(page).toContain("Conference event");
    expect(page).toContain('href="/events/synthetic-camporee"');
  });

  it("defaults to the current conference month and links to the neighbouring months", async () => {
    signedInAs("DIRECTOR");
    const page = await html();
    expect(page).toContain("November 2026");
    expect(page).toContain("?month=2026-10");
    expect(page).toContain("?month=2026-12");
    expect(mocks.listPublicCalendarItems.mock.calls[0]!.slice(0, 2)).toEqual(["2026-11-01", "2026-11-30"]);
    await html({ ...params, searchParams: Promise.resolve({ month: "2027-01" }) });
    expect(mocks.listPublicCalendarItems.mock.calls[1]!.slice(0, 2)).toEqual(["2027-01-01", "2027-01-31"]);
  });

  it("shows the page to staff acting as this club's director", async () => {
    actingAsDirector();
    expect(await html()).toContain("Add a meeting, outing or deadline");
  });

  it("is not found for everyone while the club has not switched it on", async () => {
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    for (const role of ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const) {
      signedInAs(role);
      await expect(ClubCalendarPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
    }
    actingAsDirector();
    await expect(ClubCalendarPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("gives another club's director, an Area Coordinator and staff without an act-as no access and no data", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect(await ClubCalendarPage(params)).toBeNull();
    signedInAs(null);
    expect(await ClubCalendarPage(params)).toBeNull();
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubCalendarPage(params)).toBeNull();
    actingAsDirector("club-2");
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubCalendarPage(params)).toBeNull();
    expect(mocks.prisma.clubCalendarItem.findMany).not.toHaveBeenCalled();
    expect(mocks.listPublicCalendarItems).not.toHaveBeenCalled();
  });
});

describe("writes (POST, PATCH, DELETE, PUT) are checked on the server", () => {
  const attempts: Array<[string, () => Promise<Response>]> = [
    ["add", () => POST(json("POST", goodItem), orgParams)],
    ["change", () => PATCH(json("PATCH", goodItem, "/item-1"), itemParams)],
    ["delete", () => DELETE(json("DELETE", {}, "/item-1"), itemParams)],
    ["reminders", () => PUT(json("PUT", { enabled: true, daysBefore: 3 }, "/reminders"), orgParams)],
  ];

  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s add, change, delete and set reminders, attributed to their own account", async (role) => {
    signedInAs(role);
    for (const [, attempt] of attempts) expect([200, 201]).toContain((await attempt()).status);
    expect(mocks.prisma.clubCalendarItem.create.mock.calls[0]![0].data).toMatchObject({ organizationId: "club-1", title: "Weekly meeting", createdByAccountId: "account-1", createdByUserId: null });
    expect(mocks.prisma.clubCalendarItem.updateMany.mock.calls[0]![0].where).toEqual({ id: "item-1", organizationId: "club-1" });
    expect(mocks.prisma.clubCalendarReminderSetting.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toEqual([
      "CLUB_CALENDAR_ITEM_ADDED",
      "CLUB_CALENDAR_ITEM_UPDATED",
      "CLUB_CALENDAR_ITEM_DELETED",
      "CLUB_CALENDAR_REMINDERS_TURNED_ON",
    ]);
  });

  it("audits ids and kind only, never the title, place or notes", async () => {
    signedInAs("DIRECTOR");
    await POST(json("POST", goodItem), orgParams);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.metadata).toEqual({ organizationId: "club-1", itemId: "item-9", kind: "MEETING", actorAttendeeAccountId: "account-1" });
    expect(JSON.stringify(entry)).not.toMatch(/Weekly|Fellowship|Private note|18:30/);
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s with 403 on every write and writes nothing", async (role) => {
    signedInAs(role);
    for (const [, attempt] of attempts) expect((await attempt()).status).toBe(403);
    nothingWritten();
  });

  it("answers 404 to another club's director and to an Area Coordinator with no grant here", async () => {
    signedInAs("DIRECTOR", "club-2");
    for (const [, attempt] of attempts) expect((await attempt()).status).toBe(404);
    signedInAs(null);
    for (const [, attempt] of attempts) expect((await attempt()).status).toBe(404);
    nothingWritten();
  });

  it("answers 401 to staff with no act-as, and to staff acting as another club's director", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    for (const [, attempt] of attempts) expect((await attempt()).status).toBe(401);
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    for (const [, attempt] of attempts) expect((await attempt()).status).toBe(401);
    nothingWritten();
  });

  it("records staff acting as this club's director by user and act-as", async () => {
    actingAsDirector();
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await POST(json("POST", goodItem), orgParams)).status).toBe(201);
    expect(mocks.prisma.clubCalendarItem.create.mock.calls[0]![0].data).toMatchObject({ createdByUserId: "staff-1", createdByAccountId: null });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "staff-1", metadata: { actAsId: "act-1" } });
  });

  it("answers 404 and writes nothing while the feature is off, even for a director", async () => {
    signedInAs("DIRECTOR");
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    for (const [, attempt] of attempts) expect((await attempt()).status).toBe(404);
    nothingWritten();
  });

  it("refuses an item that is not this club's: the change is scoped by club in the write itself", async () => {
    signedInAs("DIRECTOR");
    mocks.prisma.clubCalendarItem.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.clubCalendarItem.findFirst.mockResolvedValue(null);
    expect((await PATCH(json("PATCH", goodItem, "/other"), itemParams)).status).toBe(404);
    expect((await DELETE(json("DELETE", {}, "/other"), itemParams)).status).toBe(404);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ["no title", { ...goodItem, title: "" }],
    ["an impossible date", { ...goodItem, date: "2026-02-30" }],
    ["an end before the start", { ...goodItem, startTime: "20:00", endTime: "19:00" }],
    ["a club id in the body", { ...goodItem, organizationId: "club-2" }],
    ["no body", {}],
  ])("answers 400 for %s and writes nothing", async (_name, body) => {
    signedInAs("DIRECTOR");
    expect((await POST(json("POST", body), orgParams)).status).toBe(400);
    nothingWritten();
  });

  it.each([0, 15, 2.5])("answers 400 for reminder days of %s", async (daysBefore) => {
    signedInAs("DIRECTOR");
    expect((await PUT(json("PUT", { enabled: true, daysBefore }, "/reminders"), orgParams)).status).toBe(400);
    nothingWritten();
  });

  it("audits a reminder change, and writes nothing when nothing changed", async () => {
    signedInAs("DIRECTOR");
    await PUT(json("PUT", { enabled: false, daysBefore: 2 }, "/reminders"), orgParams);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled(); // no row and still off at the default
    mocks.prisma.clubCalendarReminderSetting.findUnique.mockResolvedValue({ enabled: true, daysBefore: 2 });
    await PUT(json("PUT", { enabled: true, daysBefore: 5 }, "/reminders"), orgParams);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "CLUB_CALENDAR_REMINDER_DAYS_CHANGED", metadata: { enabled: true, daysBefore: 5 } });
    await PUT(json("PUT", { enabled: false, daysBefore: 5 }, "/reminders"), orgParams);
    expect(mocks.writeAuditLog.mock.calls[1]![0]).toMatchObject({ action: "CLUB_CALENDAR_REMINDERS_TURNED_OFF" });
  });

  it("answers 429 when rate limited, before writing", async () => {
    signedInAs("DIRECTOR");
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await POST(json("POST", goodItem), orgParams)).status).toBe(429);
    nothingWritten();
  });
});
