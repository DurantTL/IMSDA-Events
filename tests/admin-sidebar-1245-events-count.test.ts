import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1245: the Events Administrator pill counts the dashboard's "Need attention" total. Synthetic data only. */

const mocks = vi.hoisted(() => ({ eventFindMany: vi.fn(), groupBy: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ event: { findMany: mocks.eventFindMany }, messageOutbox: { groupBy: mocks.groupBy } }) }));

import { countEventsAdminWaiting, getEventsAdminEventSources } from "@/modules/events/events-admin-home-repository";
import { buildEventsAdminHome } from "@/modules/events/events-admin-home-model";

const now = new Date("2026-10-26T18:00:00.000Z");
const row = {
  id: "event-a", slug: "a", name: "Synthetic A", startsAt: new Date("2026-11-20T15:00:00Z"), endsAt: new Date("2026-11-22T15:00:00Z"), timezone: "America/Chicago",
  location: null, capacity: null, isPublished: true, archivedAt: null, registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false,
  registrations: [], attendees: [], checkIns: [], memberships: [], registrationForms: [], waitlistEntries: [], importRuns: [], messageOutbox: [],
};

beforeEach(() => {
  mocks.eventFindMany.mockReset();
  mocks.groupBy.mockReset();
  mocks.groupBy.mockResolvedValue([]);
});

describe("countEventsAdminWaiting", () => {
  it("equals the dashboard's Need attention total from the same read", async () => {
    const read = () => {
      mocks.eventFindMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ id: "event-a", billingMode: "ATTENDEE_PAY", _count: { registrations: 3 } }]);
    };
    read();
    const count = await countEventsAdminWaiting(["event-a"], now);
    read();
    const dashboard = buildEventsAdminHome(await getEventsAdminEventSources(["event-a"], now), now).counts.needAttention;
    expect(count).toBe(3);
    expect(count).toBe(dashboard);
  });

  it("reads nothing for no assigned events, and lets a failed read reach the caller", async () => {
    await expect(countEventsAdminWaiting([], now)).resolves.toBe(0);
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
    mocks.eventFindMany.mockRejectedValue(new Error("synthetic outage"));
    await expect(countEventsAdminWaiting(["event-a"], now)).rejects.toThrow("synthetic outage");
  });

  it("is set on the pill only for an Events Administrator, and left off when it fails, never shown as zero", () => {
    const source = readFileSync(join(process.cwd(), "components/workspace-shell.tsx"), "utf8");
    expect(source).toContain("eventAdminEventIds.length > 0");
    expect(source).toMatch(/countEventsAdminWaiting\(eventAdminEventIds[^\n]*adminRoleCounts\.EVENTS_ADMIN = count[^\n]*\.catch\(\(\) => undefined\)/);
  });
});
