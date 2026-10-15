import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The archive and unarchive routes (#635): real authorization, origin check and
 * repository rule; only the session, the membership lookup and the database
 * are faked. Synthetic data only.
 */

const mocks = vi.hoisted(() => {
  class MockEventOperationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    EventOperationError: MockEventOperationError,
    getCurrentSession: vi.fn(),
    findActiveMembership: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    auditCreate: vi.fn(),
  };
});

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ APP_BASE_URL: "https://events.example.test" }),
  isServerEnvironmentError: () => false,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({
  EventOperationError: mocks.EventOperationError,
  findActiveMembership: mocks.findActiveMembership,
}));
vi.mock("@/lib/request-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-context")>()),
  currentCorrelationId: () => "corr-fixed-1",
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: async (run: (tx: unknown) => unknown) => run({
      event: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
      auditLog: { create: mocks.auditCreate },
    }),
  }),
}));

import { POST as archivePost } from "@/app/api/events/[eventId]/archive/route";
import { POST as unarchivePost } from "@/app/api/events/[eventId]/unarchive/route";

const routes = [
  ["archive", archivePost],
  ["unarchive", unarchivePost],
] as const;

const context = { params: Promise.resolve({ eventId: "event-a" }) };
const user = (id: string, globalRole: "SYSTEM_ADMIN" | null = null) => ({ id, email: `${id}@example.test`, displayName: id, globalRole });

function request(origin: string | null = "https://events.example.test") {
  return new Request("https://events.example.test/api/events/event-a/archive", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
}

function membership(eventId: string, userId: string, role: string) {
  return { eventId, userId, role, status: "ACTIVE", permissions: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({ id: "event-a" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.auditCreate.mockResolvedValue({});
  // A lookup that, like the real one, only knows each user's own event.
  mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => {
    if (userId === "admin-a" && eventId === "event-a") return membership("event-a", userId, "EVENT_ADMIN");
    if (userId === "admin-b" && eventId === "event-b") return membership("event-b", userId, "EVENT_ADMIN");
    if (userId === "manager-a" && eventId === "event-a") return membership("event-a", userId, "REGISTRATION_MANAGER");
    return null;
  });
});

describe.each(routes)("POST /api/events/[eventId]/%s", (name, post) => {
  it("lets the event's own Event Admin through, writing one audit row of ids", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: user("admin-a") });
    const response = await post(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ archived: name === "archive", changed: true });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const data = mocks.auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ eventId: "event-a", actorUserId: "admin-a", entityId: "event-a", metadata: { eventId: "event-a" } });
    expect(data.correlationId).toBe("corr-fixed-1");
  });

  it("lets a system administrator through", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: user("root", "SYSTEM_ADMIN") });
    expect((await post(request(), context)).status).toBe(200);
  });

  it("refuses the Event Admin of a different event with 403 and changes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: user("admin-b") });
    const response = await post(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("refuses a registration manager on the event with 403 and changes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: user("manager-a") });
    const response = await post(request(), context);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("EVENT_ARCHIVE_FORBIDDEN");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request with 401 and changes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    const response = await post(request(), context);
    expect(response.status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin or origin-less request before looking at the session", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: user("admin-a") });
    for (const origin of ["https://evil.example.test", null]) {
      const response = await post(request(origin), context);
      expect(response.status).toBe(403);
    }
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("reports an unknown event as 404", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: user("root", "SYSTEM_ADMIN") });
    mocks.findUnique.mockResolvedValue(null);
    expect((await post(request(), context)).status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
