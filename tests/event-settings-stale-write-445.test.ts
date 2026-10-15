import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings saves refuse to write over a newer event (#445). After Update on the calendar banner the event's dates
 * change under an open settings form; a save from that stale form must not write the old dates back.
 */
const dependencies = vi.hoisted(() => {
  class MockEventOperationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = "EventOperationError";
    }
  }
  return {
    EventOperationError: MockEventOperationError,
    findActiveMembership: vi.fn(),
    getCurrentSession: vi.fn(),
    getEventSettings: vi.fn(),
    updateEventSettings: vi.fn(),
    tx: {
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn(),
      event: { findUnique: vi.fn(), update: vi.fn() },
      eventPaymentInstructionVersion: { findFirst: vi.fn(), create: vi.fn() },
      promoCode: { count: vi.fn() },
      auditLog: { create: vi.fn() },
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/events/repository")>("@/modules/events/repository");
  return {
    ...actual,
    EventOperationError: dependencies.EventOperationError,
    findActiveMembership: dependencies.findActiveMembership,
    getEventSettings: dependencies.getEventSettings,
    updateEventSettings: dependencies.updateEventSettings,
  };
});

import { PATCH } from "@/app/api/events/[eventId]/route";

const payload = {
  name: "Spring Conference",
  slug: "spring-conference",
  startsOn: "2026-11-21",
  endsOn: "2026-11-23",
  timezone: "America/Chicago",
  location: "Hall Example",
  capacity: null,
  publicInfoUrl: null,
  supportContact: null,
  registrationOpensOn: null,
  registrationClosesOn: null,
  collectsShirtSizes: false,
  waitlistEnabled: false,
  autoPromoteWaitlist: false,
};
const context = { params: Promise.resolve({ eventId: "event-1" }) };
const patch = (body: unknown) => new Request("https://events.imsda.test/api/events/event-1", {
  method: "PATCH",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  dependencies.findActiveMembership.mockResolvedValue(null);
  dependencies.updateEventSettings.mockResolvedValue({ id: "event-1" });
});

describe("event settings stale-write guard (#445)", () => {
  it("hands the version the form was loaded from to the save", async () => {
    const response = await PATCH(patch({ ...payload, expectedUpdatedAt: "2026-10-15T03:00:00.000Z" }), context);
    expect(response.status).toBe(200);
    expect(dependencies.updateEventSettings).toHaveBeenCalledWith("event-1", expect.objectContaining({ startsOn: "2026-11-21" }), "admin-1", { expectedUpdatedAt: "2026-10-15T03:00:00.000Z" });
  });

  it("saves as before when no version is sent, and rejects a version that is not a timestamp", async () => {
    expect((await PATCH(patch(payload), context)).status).toBe(200);
    expect(dependencies.updateEventSettings).toHaveBeenLastCalledWith("event-1", expect.anything(), "admin-1");
    expect((await PATCH(patch({ ...payload, expectedUpdatedAt: "yesterday" }), context)).status).toBe(400);
    expect(dependencies.updateEventSettings).toHaveBeenCalledTimes(1);
  });

  it("answers a stale save with a clear conflict, not an error", async () => {
    dependencies.updateEventSettings.mockRejectedValueOnce(new dependencies.EventOperationError("EVENT_CHANGED", "This event changed after you opened it. Reload the page."));
    const response = await PATCH(patch({ ...payload, expectedUpdatedAt: "2026-10-15T03:00:00.000Z" }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "EVENT_CHANGED", message: expect.stringContaining("Reload") });
  });

  it("the repository refuses a stale version before it writes anything", async () => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({
      getPrisma: () => ({ $transaction: async (run: (tx: unknown) => unknown) => run(dependencies.tx) }),
    }));
    vi.doUnmock("@/modules/events/repository");
    const { updateEventSettings, EventOperationError } = await import("@/modules/events/repository");
    const { eventSettingsInputSchema } = await import("@/modules/events/schemas");
    dependencies.tx.event.findUnique.mockResolvedValue({ updatedAt: new Date("2026-10-15T04:00:00.000Z"), audience: "GENERAL", isPublished: false, billingMode: "ATTENDEE_PAY" });
    dependencies.tx.eventPaymentInstructionVersion.findFirst.mockResolvedValue(null);
    const input = eventSettingsInputSchema.parse(payload);
    const failure = await updateEventSettings("event-1", input, "admin-1", { expectedUpdatedAt: "2026-10-15T03:00:00.000Z" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EventOperationError);
    expect((failure as { code: string }).code).toBe("EVENT_CHANGED");
    expect(dependencies.tx.event.update).not.toHaveBeenCalled();
    expect(dependencies.tx.auditLog.create).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/prisma");
  });

  it("the form sends its version, tracks every save, publish and unpublish, and remounts on the event's version", () => {
    const workspace = readFileSync(path.join(process.cwd(), "components/event-settings-workspace.tsx"), "utf8");
    expect(workspace).toContain('...(mode === "edit" && version ? { expectedUpdatedAt: version } : {})');
    expect(workspace.match(/setVersion\(result\.event\.updatedAt\)/g)).toHaveLength(3);
    const page = readFileSync(path.join(process.cwd(), "app/(workspace)/more/event-settings/page.tsx"), "utf8");
    expect(page).toContain("key={`${event.id}:${settings.updatedAt}`}");
    expect(page).toContain("CalendarDatesConfirmation");
  });
});
