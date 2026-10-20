import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    event: { findUnique: vi.fn() },
    eventMessageSettings: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    platformSettings: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    getPrisma: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    updateCentralSender: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: <T>(handler: T) => handler }));
vi.mock("@/modules/system-admin/central-sender", async () => {
  const actual = await vi.importActual<typeof import("@/modules/system-admin/central-sender")>("@/modules/system-admin/central-sender");
  return { ...actual, updateCentralSender: mocks.updateCentralSender };
});

import { GET, PATCH } from "@/app/api/admin/email/route";
import { EventEmailPauseError, setEventEmailPaused } from "@/modules/communications/event-email-pause";

const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
const everyoneElse = [
  ["signed out", null],
  ["an event admin", { id: "user-2", globalRole: "STAFF" }],
  ["a club director", { id: "user-3", globalRole: "USER" }],
] as const;

function patch(body: unknown) {
  return PATCH(new Request("https://events.imsda-events.test/api/admin/email", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({
    $transaction: async (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx),
    event: { findMany: vi.fn().mockResolvedValue([]) },
  });
  mocks.tx.event.findUnique.mockResolvedValue({ id: "event-1" });
  mocks.tx.eventMessageSettings.findUnique.mockResolvedValue({ deliveryPaused: false });
  mocks.tx.platformSettings.findUnique.mockResolvedValue({ defaultSenderName: "IMSDA Events" });
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.updateCentralSender.mockImplementation(async (input) => input);
});

describe("pausing an event's email: system administrators only (#1043)", () => {
  it.each(everyoneElse)("refuses to pause or resume for %s, touching nothing", async (_label, actor) => {
    await expect(setEventEmailPaused({ eventId: "event-1", paused: true, actor })).rejects.toMatchObject({ code: "SYSTEM_ADMIN_REQUIRED" });
    await expect(setEventEmailPaused({ eventId: "event-1", paused: false, actor })).rejects.toBeInstanceOf(EventEmailPauseError);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.tx.eventMessageSettings.update).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("pauses for a system administrator and audits ids only", async () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const result = await setEventEmailPaused({ eventId: "event-1", paused: true, actor: admin, now });
    expect(result).toEqual({ changed: true, paused: true });
    expect(mocks.tx.eventMessageSettings.update).toHaveBeenCalledWith({
      where: { eventId: "event-1" },
      data: { deliveryPaused: true, deliveryPausedAt: now, deliveryPausedByUserId: "admin-1" },
    });
    const audit = mocks.tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ eventId: "event-1", actorUserId: "admin-1", action: "EVENT_EMAIL_PAUSED", entityId: "event-1" });
    expect(audit.metadata).toEqual({ eventId: "event-1", actorUserId: "admin-1", paused: true });
  });

  it("resumes and audits the resume", async () => {
    mocks.tx.eventMessageSettings.findUnique.mockResolvedValue({ deliveryPaused: true });
    const result = await setEventEmailPaused({ eventId: "event-1", paused: false, actor: admin });
    expect(result).toEqual({ changed: true, paused: false });
    expect(mocks.tx.eventMessageSettings.update).toHaveBeenCalledWith({
      where: { eventId: "event-1" },
      data: { deliveryPaused: false, deliveryPausedAt: null, deliveryPausedByUserId: null },
    });
    expect(mocks.tx.auditLog.create.mock.calls[0]![0].data.action).toBe("EVENT_EMAIL_RESUMED");
  });

  it("does nothing, and writes no audit row, when the event is already in that state", async () => {
    const result = await setEventEmailPaused({ eventId: "event-1", paused: false, actor: admin });
    expect(result).toEqual({ changed: false, paused: false });
    expect(mocks.tx.eventMessageSettings.update).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("creates a paused settings row for an event that has none", async () => {
    mocks.tx.eventMessageSettings.findUnique.mockResolvedValue(null);
    await setEventEmailPaused({ eventId: "event-1", paused: true, actor: admin });
    expect(mocks.tx.eventMessageSettings.create.mock.calls[0]![0].data).toMatchObject({
      eventId: "event-1", senderName: "IMSDA Events", deliveryPaused: true, deliveryPausedByUserId: "admin-1",
    });
  });

  it("reports a missing event", async () => {
    mocks.tx.event.findUnique.mockResolvedValue(null);
    await expect(setEventEmailPaused({ eventId: "gone", paused: true, actor: admin })).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("/api/admin/email (#1043)", () => {
  it.each(everyoneElse)("refuses %s on every method", async (_label, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    expect((await GET()).status).toBe(403);
    expect((await patch({ eventId: "event-1", paused: true })).status).toBe(403);
    expect((await patch({ sender: { defaultSenderName: "Hijack", defaultSenderEmail: "", defaultReplyToEmail: "" } })).status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.updateCentralSender).not.toHaveBeenCalled();
  });

  it("pauses an event for a system administrator", async () => {
    const response = await patch({ eventId: "event-1", paused: true });
    expect(response.status).toBe(200);
    expect(mocks.tx.eventMessageSettings.update).toHaveBeenCalledOnce();
    expect(mocks.tx.auditLog.create.mock.calls[0]![0].data.actorUserId).toBe("admin-1");
  });

  it("saves the central sender for a system administrator, trimming and lowercasing the address", async () => {
    const response = await patch({ sender: { defaultSenderName: "IMSDA Events", defaultSenderEmail: " Events@IMSDA-Events.test ", defaultReplyToEmail: "" } });
    expect(response.status).toBe(200);
    expect(mocks.updateCentralSender).toHaveBeenCalledWith(
      { defaultSenderName: "IMSDA Events", defaultSenderEmail: "events@imsda-events.test", defaultReplyToEmail: null },
      "admin-1",
    );
  });

  it("rejects a malformed body, an extra field and a bad address", async () => {
    expect((await patch({ eventId: "event-1" })).status).toBe(400);
    expect((await patch({ eventId: "event-1", paused: true, deliveryMode: "EXTERNAL_EMAIL" })).status).toBe(400);
    expect((await patch({ sender: { defaultSenderName: "IMSDA", defaultSenderEmail: "not-an-address", defaultReplyToEmail: "" } })).status).toBe(400);
    expect((await patch({ sender: { defaultSenderName: "IMSDA", defaultSenderEmail: "", defaultReplyToEmail: "", organizationName: "x" } })).status).toBe(400);
    expect(mocks.tx.eventMessageSettings.update).not.toHaveBeenCalled();
    expect(mocks.updateCentralSender).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin change", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await patch({ eventId: "event-1", paused: true })).status).toBe(403);
    expect(mocks.tx.eventMessageSettings.update).not.toHaveBeenCalled();
  });
});
