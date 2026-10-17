import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    requirePermission: vi.fn(),
    effectivePermissions: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    listScheduledEmails: vi.fn(),
    previewScheduledEmail: vi.fn(),
    createScheduledEmail: vi.fn(),
    updateScheduledEmail: vi.fn(),
    getScheduledEmail: vi.fn(),
    reviewStoredScheduledEmail: vi.fn(),
    activateScheduledEmail: vi.fn(),
    pauseScheduledEmail: vi.fn(),
    cancelScheduledEmail: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.AccessDeniedError,
  requirePermission: mocks.requirePermission,
  effectivePermissions: mocks.effectivePermissions,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/communications/message-files", () => ({ MessageFileError: class extends Error {} }));
vi.mock("@/modules/communications/messaging-repository", () => ({ MessagingError: class extends Error {} }));
vi.mock("@/modules/communications/scheduled-email-repository", () => ({
  listScheduledEmails: mocks.listScheduledEmails,
  previewScheduledEmail: mocks.previewScheduledEmail,
  createScheduledEmail: mocks.createScheduledEmail,
  updateScheduledEmail: mocks.updateScheduledEmail,
  getScheduledEmail: mocks.getScheduledEmail,
  reviewStoredScheduledEmail: mocks.reviewStoredScheduledEmail,
  activateScheduledEmail: mocks.activateScheduledEmail,
  pauseScheduledEmail: mocks.pauseScheduledEmail,
  cancelScheduledEmail: mocks.cancelScheduledEmail,
}));

import { GET as listGet, POST as listPost } from "@/app/api/events/[eventId]/scheduled-emails/route";
import { GET as itemGet, POST as itemPost } from "@/app/api/events/[eventId]/scheduled-emails/[scheduleId]/route";

const listContext = { params: Promise.resolve({ eventId: "event-1" }) };
const itemContext = { params: Promise.resolve({ eventId: "event-1", scheduleId: "schedule-1" }) };

function post(body: unknown, path = "scheduled-emails") {
  return new Request(`https://events.imsda.test/api/events/event-1/${path}`, {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1" }, membership: { role: "COMMUNICATIONS_MANAGER" } });
  mocks.effectivePermissions.mockReturnValue(["VIEW_EVENT", "MANAGE_COMMUNICATIONS"]);
  mocks.listScheduledEmails.mockResolvedValue([]);
  mocks.previewScheduledEmail.mockResolvedValue({ reviewFingerprint: "a".repeat(64) });
  mocks.createScheduledEmail.mockResolvedValue({ schedule: { id: "schedule-1", status: "SCHEDULED" }, replayed: false });
  mocks.updateScheduledEmail.mockResolvedValue({ id: "schedule-1", status: "SCHEDULED" });
  mocks.getScheduledEmail.mockResolvedValue({ id: "schedule-1" });
  mocks.reviewStoredScheduledEmail.mockResolvedValue({ reviewFingerprint: "a".repeat(64) });
  mocks.activateScheduledEmail.mockResolvedValue({ schedule: { id: "schedule-1", status: "ACTIVE" }, replayed: false });
  mocks.pauseScheduledEmail.mockResolvedValue({ id: "schedule-1", status: "PAUSED" });
  mocks.cancelScheduledEmail.mockResolvedValue({ id: "schedule-1", status: "CANCELLED" });
});

describe("scheduled email routes", () => {
  it("every read and write needs MANAGE_COMMUNICATIONS for this event, and nothing runs without it", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("The MANAGE_COMMUNICATIONS permission is required for this event."));
    const results = await Promise.all([
      listGet(new Request("https://events.imsda.test/x"), listContext),
      listPost(post({ action: "preview" }), listContext),
      listPost(post({ action: "create" }), listContext),
      itemGet(new Request("https://events.imsda.test/x"), itemContext),
      itemPost(post({ action: "review" }, "scheduled-emails/schedule-1"), itemContext),
      itemPost(post({ action: "activate", expectedRevision: 1, previewFingerprint: "a".repeat(64) }, "scheduled-emails/schedule-1"), itemContext),
      itemPost(post({ action: "pause" }, "scheduled-emails/schedule-1"), itemContext),
      itemPost(post({ action: "cancel" }, "scheduled-emails/schedule-1"), itemContext),
    ]);
    expect(results.map((response) => response.status)).toEqual(Array(8).fill(403));
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_COMMUNICATIONS", mocks.findActiveMembership);
    for (const name of ["listScheduledEmails", "previewScheduledEmail", "createScheduledEmail", "getScheduledEmail", "reviewStoredScheduledEmail", "activateScheduledEmail", "pauseScheduledEmail", "cancelScheduledEmail"] as const) {
      expect(mocks[name]).not.toHaveBeenCalled();
    }
  });

  it("refuses a cross-origin write before reading the body or touching anything", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await listPost(post({ action: "create" }), listContext)).status).toBe(403);
    expect((await itemPost(post({ action: "activate" }, "scheduled-emails/schedule-1"), itemContext)).status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.createScheduledEmail).not.toHaveBeenCalled();
    expect(mocks.activateScheduledEmail).not.toHaveBeenCalled();
  });

  it("builds the audience with the caller's own permissions and records the caller as the actor", async () => {
    const body = { name: "Reminder", templateKey: "BALANCE_REMINDER", rule: { trigger: "ONE_TIME", localDate: "2027-05-01", localTime: "09:00" }, query: {} };
    expect((await listPost(post({ action: "preview", ...body }), listContext)).status).toBe(200);
    expect(mocks.previewScheduledEmail).toHaveBeenCalledWith("event-1", ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"], body);
    const created = await listPost(post({ action: "create", scheduleId: "id", previewFingerprint: "a".repeat(64), ...body }), listContext);
    expect(created.status).toBe(201);
    expect(mocks.createScheduledEmail).toHaveBeenCalledWith("event-1", "staff-1", ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"], expect.objectContaining({ scheduleId: "id" }));
  });

  it("saving never approves: create and update are separate from the approval route, which is the only one that activates", async () => {
    await listPost(post({ action: "create" }), listContext);
    await listPost(post({ action: "update" }), listContext);
    expect(mocks.activateScheduledEmail).not.toHaveBeenCalled();
    const activated = await itemPost(post({ action: "activate", expectedRevision: 1, previewFingerprint: "a".repeat(64) }, "scheduled-emails/schedule-1"), itemContext);
    expect(activated.status).toBe(201);
    expect(mocks.activateScheduledEmail).toHaveBeenCalledWith(
      "event-1",
      "staff-1",
      ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"],
      "schedule-1",
      { expectedRevision: 1, previewFingerprint: "a".repeat(64) },
    );
  });

  it("a replayed approval answers 200, and an unknown action is a 400", async () => {
    mocks.activateScheduledEmail.mockResolvedValue({ schedule: { id: "schedule-1", status: "ACTIVE" }, replayed: true });
    expect((await itemPost(post({ action: "activate", expectedRevision: 1, previewFingerprint: "a".repeat(64) }, "scheduled-emails/schedule-1"), itemContext)).status).toBe(200);
    expect((await itemPost(post({ action: "send-now" }, "scheduled-emails/schedule-1"), itemContext)).status).toBe(400);
    expect((await listPost(post({ action: "activate" }), listContext)).status).toBe(400);
  });

  it("pause and cancel act on the event's own schedule id for the signed-in person", async () => {
    expect((await itemPost(post({ action: "pause" }, "scheduled-emails/schedule-1"), itemContext)).status).toBe(200);
    expect(mocks.pauseScheduledEmail).toHaveBeenCalledWith("event-1", "staff-1", "schedule-1");
    expect((await itemPost(post({ action: "cancel" }, "scheduled-emails/schedule-1"), itemContext)).status).toBe(200);
    expect(mocks.cancelScheduledEmail).toHaveBeenCalledWith("event-1", "staff-1", "schedule-1");
  });
});
