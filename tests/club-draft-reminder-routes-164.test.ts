import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #164: the staff routes for the unfinished club registration reminders need MANAGE_COMMUNICATIONS for the event, check
 * the request's origin on a write, and refuse anything but the five known fields. Synthetic data only.
 */
const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    getOverview: vi.fn(),
    savePolicy: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/communications/message-files", () => ({ MessageFileError: class extends Error {} }));
vi.mock("@/modules/communications/messaging-repository", () => ({ MessagingError: class extends Error {} }));
vi.mock("@/modules/club-registrations/draft-reminders", () => ({ getClubDraftReminderOverview: mocks.getOverview, saveClubDraftReminderPolicy: mocks.savePolicy }));

import { GET, PUT } from "@/app/api/events/[eventId]/club-draft-reminders/route";
import { clubDraftReminderPolicySchema } from "@/modules/club-registrations/draft-reminders-domain";
import { ZodError } from "zod";

const context = { params: Promise.resolve({ eventId: "event-1" }) };
const valid = { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 };

function put(body: unknown) {
  return new Request("https://events.imsda.test/api/events/event-1/club-draft-reminders", {
    method: "PUT",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1" }, membership: { role: "COMMUNICATIONS_MANAGER" } });
  mocks.getOverview.mockResolvedValue({ policy: valid, counts: { queued: 0 } });
  mocks.savePolicy.mockImplementation(async (_eventId: string, _actor: string, input: unknown) => {
    clubDraftReminderPolicySchema.parse(input);
    return { changed: true, found: true, policy: valid };
  });
});

describe("club registration reminder routes", () => {
  it("every read and write needs MANAGE_COMMUNICATIONS for this event, and nothing runs without it", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("The MANAGE_COMMUNICATIONS permission is required for this event."));
    const results = await Promise.all([GET(new Request("https://events.imsda.test/x"), context), PUT(put(valid), context)]);
    expect(results.map((response) => response.status)).toEqual([403, 403]);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_COMMUNICATIONS", mocks.findActiveMembership);
    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.savePolicy).not.toHaveBeenCalled();
  });

  it("answers 401 to someone with no session", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("Sign in to continue.", 401, "AUTHENTICATION_REQUIRED"));
    expect((await GET(new Request("https://events.imsda.test/x"), context)).status).toBe(401);
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin write before touching anything", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await PUT(put(valid), context)).status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.savePolicy).not.toHaveBeenCalled();
  });

  it("saves as the signed-in user for this event and returns the fresh overview, never cached", async () => {
    const response = await PUT(put(valid), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.savePolicy).toHaveBeenCalledWith("event-1", "staff-1", valid);
    expect(await response.json()).toMatchObject({ changed: true, overview: { policy: valid } });
  });

  it("reads the overview for this event", async () => {
    const response = await GET(new Request("https://events.imsda.test/x"), context);
    expect(response.status).toBe(200);
    expect(mocks.getOverview).toHaveBeenCalledWith("event-1");
  });

  it.each([
    ["an unknown field", { ...valid, extra: true }],
    ["a number out of range", { ...valid, maxReminders: 4 }],
    ["a text number", { ...valid, firstAfterDays: "2" }],
    ["a missing field", { enabled: true }],
  ])("answers 400 to %s", async (_label, body) => {
    const response = await PUT(put(body), context);
    expect(response.status).toBe(400);
  });

  it("answers 404 for an event that does not exist", async () => {
    mocks.savePolicy.mockResolvedValueOnce({ changed: false, found: false, policy: valid });
    expect((await PUT(put(valid), context)).status).toBe(404);
  });

  it("answers 400 to a body that is not JSON", async () => {
    const response = await PUT(new Request("https://events.imsda.test/x", { method: "PUT", headers: { origin: "https://events.imsda.test" }, body: "not json" }), context);
    expect(response.status).toBe(400);
  });

  it("the schema the route enforces is the shared strict one", () => {
    expect(() => clubDraftReminderPolicySchema.parse({ ...valid, extra: 1 })).toThrow(ZodError);
  });
});
