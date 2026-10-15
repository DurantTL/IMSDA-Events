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
  const loaded = { expectedStartsOn: "2026-11-07", expectedEndsOn: "2026-11-09" };

  it("hands the dates the form was loaded with to the save", async () => {
    const response = await PATCH(patch({ ...payload, ...loaded }), context);
    expect(response.status).toBe(200);
    expect(dependencies.updateEventSettings).toHaveBeenCalledWith("event-1", expect.objectContaining({ startsOn: "2026-11-21" }), "admin-1", loaded);
  });

  it("saves as before when no dates are sent, and rejects ones that are not dates", async () => {
    expect((await PATCH(patch(payload), context)).status).toBe(200);
    expect(dependencies.updateEventSettings).toHaveBeenLastCalledWith("event-1", expect.anything(), "admin-1");
    expect((await PATCH(patch({ ...payload, expectedStartsOn: "yesterday" }), context)).status).toBe(400);
    expect(dependencies.updateEventSettings).toHaveBeenCalledTimes(1);
  });

  it("answers a save over changed dates with a clear conflict, not an error", async () => {
    dependencies.updateEventSettings.mockRejectedValueOnce(new dependencies.EventOperationError("EVENT_CHANGED", "This event's dates changed after you opened the page. Reload."));
    const response = await PATCH(patch({ ...payload, ...loaded }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "EVENT_CHANGED", message: expect.stringContaining("dates changed") });
  });

  describe("in the repository", () => {
    async function load() {
      vi.resetModules();
      vi.doMock("@/lib/prisma", () => ({
        getPrisma: () => ({ $transaction: async (run: (tx: unknown) => unknown) => run(dependencies.tx) }),
      }));
      vi.doUnmock("@/modules/events/repository");
      const { updateEventSettings, EventOperationError } = await import("@/modules/events/repository");
      const { eventSettingsInputSchema } = await import("@/modules/events/schemas");
      return { updateEventSettings, EventOperationError, input: eventSettingsInputSchema.parse(payload) };
    }
    const stored = { startsAt: new Date("2026-11-21T12:00:00.000Z"), endsAt: new Date("2026-11-23T12:00:00.000Z"), timezone: "America/Chicago", audience: "GENERAL", isPublished: false, billingMode: "ATTENDEE_PAY" };

    it("refuses dates that changed under the form, before it writes anything", async () => {
      const { updateEventSettings, EventOperationError, input } = await load();
      dependencies.tx.event.findUnique.mockResolvedValue(stored);
      dependencies.tx.eventPaymentInstructionVersion.findFirst.mockResolvedValue(null);
      const failure = await updateEventSettings("event-1", input, "admin-1", { expectedStartsOn: "2026-11-07", expectedEndsOn: "2026-11-09" }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EventOperationError);
      expect((failure as { code: string; message: string }).code).toBe("EVENT_CHANGED");
      expect((failure as Error).message).toContain("dates changed after you opened the page");
      expect(dependencies.tx.event.update).not.toHaveBeenCalled();
      expect(dependencies.tx.auditLog.create).not.toHaveBeenCalled();
      // The end date alone is enough.
      const lateFailure = await updateEventSettings("event-1", input, "admin-1", { expectedStartsOn: "2026-11-21", expectedEndsOn: "2026-11-25" }).catch((error: unknown) => error);
      expect((lateFailure as { code: string }).code).toBe("EVENT_CHANGED");
      vi.doUnmock("@/lib/prisma");
    });

    it("lets a save through when only something else changed since the form was opened (the general link, a setting on another page)", async () => {
      const { updateEventSettings, input } = await load();
      // Another page wrote the event (its updatedAt moved); the dates are the ones the form was loaded with.
      dependencies.tx.event.findUnique.mockResolvedValue({ ...stored, updatedAt: new Date("2026-10-15T09:00:00.000Z") });
      dependencies.tx.eventPaymentInstructionVersion.findFirst.mockResolvedValue(null);
      dependencies.tx.event.update.mockRejectedValue(new Error("reached the write"));
      await expect(updateEventSettings("event-1", input, "admin-1", { expectedStartsOn: "2026-11-21", expectedEndsOn: "2026-11-23" })).rejects.toThrow("reached the write");
      expect(dependencies.tx.event.update).toHaveBeenCalledTimes(1);
      vi.doUnmock("@/lib/prisma");
    });
  });

  it("the form sends the dates it loaded, tracks every save, publish and unpublish, and remounts on the event's dates", () => {
    const workspace = readFileSync(path.join(process.cwd(), "components/event-settings-workspace.tsx"), "utf8");
    expect(workspace).toContain('...(mode === "edit" && loadedDates ? { expectedStartsOn: loadedDates.startsOn, expectedEndsOn: loadedDates.endsOn } : {})');
    expect(workspace.match(/setLoadedDates\(\{ startsOn: result\.event\.startsOn, endsOn: result\.event\.endsOn \}\)/g)).toHaveLength(3);
    expect(workspace).not.toContain("expectedUpdatedAt");
    const page = readFileSync(path.join(process.cwd(), "app/(workspace)/more/event-settings/page.tsx"), "utf8");
    expect(page).toContain("key={`${event.id}:${settings.startsOn}:${settings.endsOn}`}");
    expect(page).toContain("CalendarDatesConfirmation");
  });

  it("the banner waits while the form has unsaved changes", () => {
    const banner = readFileSync(path.join(process.cwd(), "components/calendar-link-banner.tsx"), "utf8");
    expect(banner).toContain("Save or discard your changes first");
    expect(banner).toContain("disabled={busy || unsaved ||");
    expect(banner).toContain('disabled={busy || unsaved} onClick={() => answer("keep")}');
    const workspace = readFileSync(path.join(process.cwd(), "components/event-settings-workspace.tsx"), "utf8");
    expect(workspace).toContain("setEventSettingsDirty(dirty)");
  });
});
