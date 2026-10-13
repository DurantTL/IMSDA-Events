import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The staff routes for deadline reminders (#910): system administrators only, same origin only, one action per
 * batch, and delivery of an approved batch runs after the response (never before approval).
 */
const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  requireSystemAdministrator: vi.fn(),
  listPendingReminderBatches: vi.fn(),
  sendReminderBatch: vi.fn(),
  dismissReminderBatch: vi.fn(),
  processAccountEmailQueue: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => { mocks.afterCallbacks.push(callback); } }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/access", () => ({ requireSystemAdministrator: mocks.requireSystemAdministrator }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));
vi.mock("@/modules/calendar/repository", () => ({ CalendarError: class CalendarError extends Error { code = "ENTRY_NOT_FOUND"; } }));
vi.mock("@/modules/calendar/deadline-reminders", async () => {
  class DeadlineReminderError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    DeadlineReminderError,
    listPendingReminderBatches: mocks.listPendingReminderBatches,
    sendReminderBatch: mocks.sendReminderBatch,
    dismissReminderBatch: mocks.dismissReminderBatch,
  };
});

import { GET } from "@/app/api/admin/calendar/deadline-reminders/route";
import { POST } from "@/app/api/admin/calendar/deadline-reminders/[batchId]/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { DeadlineReminderError } from "@/modules/calendar/deadline-reminders";

const fingerprint = "a".repeat(64);
const post = (body: unknown) => POST(
  new Request("https://events.imsda.test/api/admin/calendar/deadline-reminders/batch-1", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ batchId: "batch-1" }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireSystemAdministrator.mockResolvedValue({ id: "admin-1" });
  mocks.listPendingReminderBatches.mockResolvedValue({ batches: [], emailConfigured: true });
  mocks.sendReminderBatch.mockResolvedValue({ sent: 2, optedOut: 1, messageIds: ["m1", "m2"] });
  mocks.dismissReminderBatch.mockResolvedValue(undefined);
  mocks.processAccountEmailQueue.mockResolvedValue({ sentIds: ["m1", "m2"] });
});

describe("GET /api/admin/calendar/deadline-reminders", () => {
  it("lists the waiting batches for a system administrator", async () => {
    const response = await GET(new Request("https://events.imsda.test/api/admin/calendar/deadline-reminders"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ batches: [], emailConfigured: true });
  });

  it("refuses everyone else", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await GET(new Request("https://events.imsda.test/api/admin/calendar/deadline-reminders"))).status).toBe(403);
    expect(mocks.listPendingReminderBatches).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/calendar/deadline-reminders/[batchId]", () => {
  it("rejects a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({}, { status: 403 }));
    expect((await post({ action: "send", fingerprint })).status).toBe(403);
    expect(mocks.requireSystemAdministrator).not.toHaveBeenCalled();
    expect(mocks.sendReminderBatch).not.toHaveBeenCalled();
  });

  it("is closed to anyone but a system administrator", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    expect((await post({ action: "send", fingerprint })).status).toBe(403);
    expect((await post({ action: "dismiss" })).status).toBe(403);
    expect(mocks.sendReminderBatch).not.toHaveBeenCalled();
    expect(mocks.dismissReminderBatch).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("sends with one action, naming the administrator, and delivers only after the response", async () => {
    const response = await post({ action: "send", fingerprint });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 2, optedOut: 1 });
    expect(mocks.sendReminderBatch).toHaveBeenCalledWith("batch-1", { fingerprint }, "admin-1");
    // Nothing has been handed to the delivery queue yet; it runs after the response.
    expect(mocks.processAccountEmailQueue).not.toHaveBeenCalled();
    await mocks.afterCallbacks[0]();
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["m1", "m2"], limit: 2 });
  });

  it("still answers when delivery fails after the response (the sweep retries)", async () => {
    mocks.processAccountEmailQueue.mockRejectedValue(new Error("provider down"));
    expect((await post({ action: "send", fingerprint })).status).toBe(200);
    await expect(mocks.afterCallbacks[0]()).resolves.toBeUndefined();
  });

  it("dismisses without queueing or delivering anything", async () => {
    expect((await post({ action: "dismiss" })).status).toBe(200);
    expect(mocks.dismissReminderBatch).toHaveBeenCalledWith("batch-1", "admin-1");
    expect(mocks.sendReminderBatch).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it.each([
    ["an unknown action", { action: "resend" }],
    ["a send with no fingerprint", { action: "send" }],
    ["a send with a malformed fingerprint", { action: "send", fingerprint: "nope" }],
    ["extra fields", { action: "dismiss", force: true }],
  ])("refuses %s", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.sendReminderBatch).not.toHaveBeenCalled();
    expect(mocks.dismissReminderBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["BATCH_NOT_FOUND", 404],
    ["BATCH_NOT_PENDING", 409],
    ["BATCH_WITHDRAWN", 409],
    ["BATCH_CHANGED", 409],
    ["NO_RECIPIENTS", 409],
    ["EMAIL_NOT_CONFIGURED", 503],
  ])("answers %s with %i and queues no delivery", async (code, status) => {
    mocks.sendReminderBatch.mockRejectedValue(new DeadlineReminderError(code as never, "Said so."));
    const response = await post({ action: "send", fingerprint });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code, message: "Said so." });
    expect(mocks.afterCallbacks).toHaveLength(0);
  });
});
