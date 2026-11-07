import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const calls: string[] = [];
const attention = vi.fn(async () => { calls.push("attention"); return { unreadable: [], groups: [], total: 0, partial: false }; });
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: () => attention() }));
vi.mock("@/modules/club-applications/repository", () => ({ countWaitingNewClubApplications: vi.fn(async (viewer: string) => { calls.push(`applications:${viewer}`); return 2; }) }));
vi.mock("@/modules/events/events-admin-home-repository", () => ({ getEventsAdminEventSources: vi.fn(async (ids: string[]) => { calls.push(`events:${ids.join(",")}`); return []; }) }));
vi.mock("@/modules/system-admin/admin-hubs-repository", () => ({ loadMetrics: vi.fn(async (keys: string[]) => { calls.push(`metrics:${keys.join(",")}`); return { lateRecords: 1 }; }) }));

const { loadNeedsInput } = await import("@/modules/system-admin/home-needs-repository");
const now = new Date("2026-11-07T18:00:00Z");

beforeEach(() => { calls.length = 0; attention.mockClear(); });

describe("Needs you reads (#1568)", () => {
  it("reads nothing for a person who holds no admin role", async () => {
    const input = await loadNeedsInput({ systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: [] }, [], now);
    expect(calls).toEqual([]);
    expect(input).toMatchObject({ held: [], events: null, attention: null });
  });

  it("reads only the roles held, with the same scope as the role pills", async () => {
    await loadNeedsInput({ systemAdmin: false, clubsAdministrator: true, eventAdminEventIds: ["evt_1"] }, ["EVENTS_ADMIN", "CLUBS_ADMIN"], now);
    expect(attention).not.toHaveBeenCalled();
    expect(calls).toContain("events:evt_1");
    expect(calls).toContain("applications:CLUBS_ADMIN");
    expect(calls).toContain("metrics:lateRecords");
  });

  it("reads the attention summary only for a system administrator", async () => {
    const input = await loadNeedsInput({ systemAdmin: true, clubsAdministrator: true, eventAdminEventIds: [] }, ["CLUBS_ADMIN", "SYSTEM_ADMIN"], now);
    expect(attention).toHaveBeenCalledTimes(1);
    expect(calls).toContain("applications:SYSTEM_ADMIN");
    expect(calls.some((call) => call.startsWith("events:"))).toBe(false);
    expect(input.clubs).toEqual({ applications: 2, lateRecords: 1 });
  });
});
