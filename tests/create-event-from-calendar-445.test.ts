import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  getCurrentSession: vi.fn(),
  createEvent: vi.fn(),
  applyEventTemplate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/events/repository")>("@/modules/events/repository");
  return { ...actual, createEvent: mocks.createEvent, listEventsForUser: vi.fn() };
});
vi.mock("@/modules/event-templates/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/event-templates/repository")>("@/modules/event-templates/repository");
  return { ...actual, applyEventTemplate: mocks.applyEventTemplate };
});

import { POST as CREATE } from "@/app/api/events/route";
import { POST as APPLY } from "@/app/api/event-templates/[templateId]/apply/route";
import { CalendarError } from "@/modules/calendar/errors";
import { applyEventTemplateInputSchema } from "@/modules/event-templates/domain";

const admin = { user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } };
const settings = {
  name: "Womens Retreat",
  slug: "womens-retreat",
  startsOn: "2026-10-09",
  endsOn: "2026-10-11",
  timezone: "America/Chicago",
  location: "Camp Example",
  publicInfoUrl: null,
  supportContact: null,
  collectsShirtSizes: false,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
  autoPromoteWaitlist: false,
  capacity: null,
};
const post = (body: unknown) => new Request("https://events.imsda.test/api/events", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue(admin);
  mocks.createEvent.mockResolvedValue({ id: "event-1" });
  mocks.applyEventTemplate.mockResolvedValue({ event: { id: "event-1" }, alreadyApplied: false });
});

describe("Create event from a calendar item (#445)", () => {
  it("passes the item's id to the creation, from the same permission as any event creation", async () => {
    const response = await CREATE(post({ ...settings, calendarEntryId: "entry-1" }));
    expect(response.status).toBe(201);
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "Womens Retreat", location: "Camp Example" }), "admin-1", { calendarEntryId: "entry-1" });
  });

  it("is unchanged without an item", async () => {
    await CREATE(post(settings));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.anything(), "admin-1");
  });

  it("is refused to anyone who can't create events, with nothing created", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1", globalRole: "STAFF" } });
    expect((await CREATE(post({ ...settings, calendarEntryId: "entry-1" }))).status).toBe(403);
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("answers an item that can no longer be linked with a conflict, not a server error", async () => {
    mocks.createEvent.mockRejectedValueOnce(new CalendarError("ENTRY_ALREADY_LINKED", "That calendar item already has a registration event."));
    const taken = await CREATE(post({ ...settings, calendarEntryId: "entry-1" }));
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe("ENTRY_ALREADY_LINKED");
    mocks.createEvent.mockRejectedValueOnce(new CalendarError("ENTRY_NOT_FOUND", "Gone."));
    expect((await CREATE(post({ ...settings, calendarEntryId: "missing" }))).status).toBe(404);
  });

  it("the template flow accepts the item's id the same way", async () => {
    const body = { name: "Womens Retreat", slug: "womens-retreat", startsOn: "2026-10-09", endsOn: "2026-10-11", requestKey: "request-key-0001", calendarEntryId: "entry-1" };
    expect(applyEventTemplateInputSchema.parse(body).calendarEntryId).toBe("entry-1");
    expect(applyEventTemplateInputSchema.parse({ ...body, calendarEntryId: undefined }).calendarEntryId).toBeUndefined();
    const response = await APPLY(post(body), { params: Promise.resolve({ templateId: "template-1" }) });
    expect(response.status).toBe(201);
    expect(mocks.applyEventTemplate).toHaveBeenCalledWith("template-1", "admin-1", expect.objectContaining({ calendarEntryId: "entry-1" }));
    mocks.applyEventTemplate.mockRejectedValueOnce(new CalendarError("ENTRY_ALREADY_LINKED", "That calendar item already has a registration event."));
    expect((await APPLY(post(body), { params: Promise.resolve({ templateId: "template-1" }) })).status).toBe(409);
  });
});
