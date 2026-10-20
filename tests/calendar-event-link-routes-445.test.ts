import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  requireSystemAdministrator: vi.fn(),
  requirePermission: vi.fn(),
  getCurrentSession: vi.fn(),
  linkCalendarEntryToEvent: vi.fn(),
  unlinkCalendarEntry: vi.fn(),
  dismissPossibleMatch: vi.fn(),
  resolveCalendarDateChange: vi.fn(),
  listCalendarEntries: vi.fn(),
  listCalendarEvents: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/access", () => ({ requireSystemAdministrator: mocks.requireSystemAdministrator }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/modules/access/authorization")>("@/modules/access/authorization");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/calendar/event-links", () => ({
  linkCalendarEntryToEvent: mocks.linkCalendarEntryToEvent,
  unlinkCalendarEntry: mocks.unlinkCalendarEntry,
  dismissPossibleMatch: mocks.dismissPossibleMatch,
  resolveCalendarDateChange: mocks.resolveCalendarDateChange,
}));
vi.mock("@/modules/calendar/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/calendar/repository")>("@/modules/calendar/repository");
  return { ...actual, listCalendarEntries: mocks.listCalendarEntries, listCalendarEvents: mocks.listCalendarEvents };
});

import { POST as LINK } from "@/app/api/admin/calendar/entries/[entryId]/event-link/route";
import { POST as DATE_CHANGE } from "@/app/api/admin/calendar/events/[eventId]/date-change/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { CalendarError } from "@/modules/calendar/errors";

const request = (body?: unknown) => new Request("https://events.imsda.test/api/admin/calendar/x", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const entryCtx = { params: Promise.resolve({ entryId: "entry-1" }) };
const eventCtx = { params: Promise.resolve({ eventId: "event-1" }) };
const dates = { startsOn: "2026-11-07", endsOn: "2026-11-09" };

const calls = () => [
  () => LINK(request({ action: "link", eventId: "event-1" }), entryCtx),
  () => LINK(request({ action: "unlink" }), entryCtx),
  () => LINK(request({ action: "notSame", eventId: "event-1" }), entryCtx),
];
const writers = [mocks.linkCalendarEntryToEvent, mocks.unlinkCalendarEntry, mocks.dismissPossibleMatch, mocks.resolveCalendarDateChange];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireSystemAdministrator.mockResolvedValue({ id: "admin-1" });
  mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1" } });
  for (const writer of writers) writer.mockResolvedValue(undefined);
  mocks.listCalendarEntries.mockResolvedValue([]);
  mocks.listCalendarEvents.mockResolvedValue([]);
});

describe("calendar item and event link routes (#445)", () => {
  it("is closed to anyone but a system administrator, and does nothing for them", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    for (const call of calls()) expect((await call()).status).toBe(403);
    for (const writer of writers) expect(writer).not.toHaveBeenCalled();
  });

  it("refuses cross-origin writes before checking anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({}, { status: 403 }));
    for (const call of [...calls(), () => DATE_CHANGE(request({ decision: "keep", ...dates }), eventCtx)]) expect((await call()).status).toBe(403);
    expect(mocks.requireSystemAdministrator).not.toHaveBeenCalled();
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    for (const writer of writers) expect(writer).not.toHaveBeenCalled();
  });

  it("links, unlinks and dismisses as the signed-in administrator, then returns the fresh lists", async () => {
    const linked = await LINK(request({ action: "link", eventId: "event-1" }), entryCtx);
    expect(linked.status).toBe(200);
    expect(await linked.json()).toEqual({ entries: [], events: [] });
    expect(mocks.linkCalendarEntryToEvent).toHaveBeenCalledWith("entry-1", "event-1", "admin-1");
    await LINK(request({ action: "unlink" }), entryCtx);
    expect(mocks.unlinkCalendarEntry).toHaveBeenCalledWith("entry-1", "admin-1");
    await LINK(request({ action: "notSame", eventId: "event-1" }), entryCtx);
    expect(mocks.dismissPossibleMatch).toHaveBeenCalledWith("entry-1", "event-1", "admin-1");
  });

  it("rejects an unknown action, a missing event id and extra fields", async () => {
    for (const body of [{ action: "merge", eventId: "event-1" }, { action: "link" }, { action: "unlink", eventId: "event-1" }, {}]) {
      expect((await LINK(request(body), entryCtx)).status).toBe(400);
    }
    for (const writer of writers) expect(writer).not.toHaveBeenCalled();
  });

  it("passes the item an answer is about when several are linked (#1086)", async () => {
    const response = await DATE_CHANGE(request({ decision: "keep", ...dates, entryId: "entry-2" }), eventCtx);
    expect(response.status).toBe(200);
    expect(mocks.resolveCalendarDateChange).toHaveBeenLastCalledWith("event-1", "keep", dates, expect.any(String), "entry-2");
    mocks.resolveCalendarDateChange.mockRejectedValueOnce(new CalendarError("UPDATE_NEEDS_SINGLE_LINK", "Several items."));
    expect((await DATE_CHANGE(request({ decision: "update", ...dates, entryId: "entry-2" }), eventCtx)).status).toBe(409);
  });

  it("reports a conflict or a missing item with its own status", async () => {
    mocks.linkCalendarEntryToEvent.mockRejectedValueOnce(new CalendarError("ENTRY_ALREADY_LINKED", "Taken."));
    expect((await LINK(request({ action: "link", eventId: "event-1" }), entryCtx)).status).toBe(409);
    mocks.linkCalendarEntryToEvent.mockRejectedValueOnce(new CalendarError("ENTRY_NOT_FOUND", "Gone."));
    expect((await LINK(request({ action: "link", eventId: "event-1" }), entryCtx)).status).toBe(404);
    mocks.linkCalendarEntryToEvent.mockRejectedValueOnce(new CalendarError("NOT_LINKABLE", "No."));
    expect((await LINK(request({ action: "link", eventId: "event-1" }), entryCtx)).status).toBe(409);
  });

  it("lets whoever may configure the event answer, and nobody else, checked through event membership", async () => {
    // The event's own Event Admin (not a system administrator) is let in by the same check event settings use.
    mocks.requirePermission.mockResolvedValue({ user: { id: "event-admin-1", globalRole: null } });
    expect((await DATE_CHANGE(request({ decision: "keep", ...dates }), eventCtx)).status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "CONFIGURE_EVENT", expect.any(Function));
    expect(mocks.resolveCalendarDateChange).toHaveBeenCalledWith("event-1", "keep", dates, "event-admin-1", undefined);
    // Anyone else is refused before anything is written.
    mocks.resolveCalendarDateChange.mockClear();
    mocks.requirePermission.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await DATE_CHANGE(request({ decision: "update", ...dates }), eventCtx)).status).toBe(403);
    expect(mocks.resolveCalendarDateChange).not.toHaveBeenCalled();
    // Linking and unlinking stay with system administrators.
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await LINK(request({ action: "unlink" }), entryCtx)).status).toBe(403);
  });

  it("applies a date decision only with the dates the staff member saw", async () => {
    const response = await DATE_CHANGE(request({ decision: "update", ...dates }), eventCtx);
    expect(response.status).toBe(200);
    expect(mocks.resolveCalendarDateChange).toHaveBeenCalledWith("event-1", "update", dates, "admin-1", undefined);
    await DATE_CHANGE(request({ decision: "keep", ...dates }), eventCtx);
    expect(mocks.resolveCalendarDateChange).toHaveBeenLastCalledWith("event-1", "keep", dates, "admin-1", undefined);
    for (const body of [{ decision: "update" }, { decision: "maybe", ...dates }, { decision: "keep", startsOn: "soon", endsOn: "later" }, { decision: "keep", ...dates, extra: 1 }]) {
      expect((await DATE_CHANGE(request(body), eventCtx)).status).toBe(400);
    }
    expect(mocks.resolveCalendarDateChange).toHaveBeenCalledTimes(2);
  });

  it("tells staff when the item moved again while they looked, or the new dates conflict", async () => {
    mocks.resolveCalendarDateChange.mockRejectedValueOnce(new CalendarError("DATES_CHANGED", "Moved again."));
    expect((await DATE_CHANGE(request({ decision: "update", ...dates }), eventCtx)).status).toBe(409);
    mocks.resolveCalendarDateChange.mockRejectedValueOnce(new CalendarError("DATES_CONFLICT", "Registration opens late."));
    expect((await DATE_CHANGE(request({ decision: "update", ...dates }), eventCtx)).status).toBe(409);
  });
});
