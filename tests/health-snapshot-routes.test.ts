import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  staffViewer: vi.fn(),
  repo: {
    startSnapshotBreakGlass: vi.fn(),
    viewSealedSnapshots: vi.fn(),
    placeSnapshotHold: vi.fn(),
    liftSnapshotHold: vi.fn(),
    listSnapshotHolds: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HEALTH_RECORDS_ENABLED: state.enabled }) }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/club-rosters/access", () => ({
  RosterAccessError: class RosterAccessError extends Error {
    constructor(public readonly code: string, public readonly status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/modules/health-records/access", () => ({ requireStaffHealthViewer: state.staffViewer }));
vi.mock("@/modules/health-records/snapshot-access-repository", () => state.repo);

import * as breakGlassRoute from "@/app/api/staff/health-snapshots/break-glass/route";
import * as personRoute from "@/app/api/staff/health-snapshots/person/[personId]/route";
import * as holdsRoute from "@/app/api/staff/health-snapshots/holds/route";
import * as liftRoute from "@/app/api/staff/health-snapshots/holds/[holdId]/lift/route";
import { HealthRecordError } from "@/modules/health-records/errors";

/** The routes for sealed per-event health copies (#924). Synthetic ids and reasons only. */

const ctx = { params: Promise.resolve({ personId: "person-1", holdId: "hold-1" }) };
const REASON = "Synthetic reason for the route check";

function post(body: unknown) {
  return new Request("https://events.imsda.test/api/staff/health-snapshots", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify(body),
  });
}

const get = () => new Request("https://events.imsda.test/api/staff/health-snapshots", { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.staffViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
});

describe("with the health records switch off", () => {
  it("answers every route like an unknown one, before reading a body or a session", async () => {
    state.enabled = false;
    const responses = await Promise.all([
      breakGlassRoute.POST(post({ personId: "person-1", reason: REASON })),
      personRoute.GET(get(), ctx),
      holdsRoute.GET(get()),
      holdsRoute.POST(post({ scope: "PERSON", personId: "person-1", reason: REASON })),
      liftRoute.POST(post({ reason: REASON }), ctx),
    ]);
    for (const response of responses) expect(response.status).toBe(404);
    expect(state.staffViewer).not.toHaveBeenCalled();
    for (const fn of Object.values(state.repo)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("break-glass and viewing", () => {
  it("starts break-glass with a typed reason and returns the grant, never a value", async () => {
    state.repo.startSnapshotBreakGlass.mockResolvedValue({ grantId: "grant-1", expiresAt: new Date("2026-10-15T12:00:00Z"), snapshotCount: 2 });
    const response = await breakGlassRoute.POST(post({ personId: "person-1", reason: REASON }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, grantId: "grant-1", expiresAt: "2026-10-15T12:00:00.000Z", snapshotCount: 2 });
    expect(state.repo.startSnapshotBreakGlass).toHaveBeenCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" }, { personId: "person-1", reason: REASON });
  });

  it("rejects a body with extra keys, and is private and uncacheable", async () => {
    const response = await breakGlassRoute.POST(post({ personId: "person-1", reason: REASON, extra: true }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.repo.startSnapshotBreakGlass).not.toHaveBeenCalled();
  });

  it("answers a refusal with its code and a fixed message", async () => {
    state.repo.viewSealedSnapshots.mockRejectedValue(new HealthRecordError("BREAK_GLASS_REQUIRED", "Opening a sealed health copy needs break-glass: type a reason first. Access lasts 24 hours."));
    const response = await personRoute.GET(get(), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "BREAK_GLASS_REQUIRED" });
  });

  it("opens a person's copies for the viewer the staff gate produced", async () => {
    state.repo.viewSealedSnapshots.mockResolvedValue({ grantId: "grant-1", snapshots: [] });
    const response = await personRoute.GET(get(), ctx);
    expect(response.status).toBe(200);
    expect(state.repo.viewSealedSnapshots).toHaveBeenCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" }, "person-1");
  });
});

describe("holds", () => {
  it("places a person hold and an event hold, and refuses a body that names both", async () => {
    state.repo.placeSnapshotHold.mockResolvedValue({ holdId: "hold-1", alreadyHeld: false, snapshotsCovered: 1 });
    expect((await holdsRoute.POST(post({ scope: "PERSON", personId: "person-1", reason: REASON }))).status).toBe(200);
    expect(state.repo.placeSnapshotHold).toHaveBeenLastCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" }, { scope: "PERSON", personId: "person-1" }, REASON);
    expect((await holdsRoute.POST(post({ scope: "EVENT", eventId: "event-1", reason: REASON }))).status).toBe(200);
    expect(state.repo.placeSnapshotHold).toHaveBeenLastCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" }, { scope: "EVENT", eventId: "event-1" }, REASON);
    expect((await holdsRoute.POST(post({ scope: "EVENT", eventId: "event-1", personId: "person-1", reason: REASON }))).status).toBe(400);
  });

  it("lifts a hold with a reason and lists holds", async () => {
    state.repo.liftSnapshotHold.mockResolvedValue({ holdId: "hold-1" });
    state.repo.listSnapshotHolds.mockResolvedValue([]);
    expect((await liftRoute.POST(post({ reason: REASON }), ctx)).status).toBe(200);
    expect(state.repo.liftSnapshotHold).toHaveBeenCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" }, "hold-1", REASON);
    const listed = await holdsRoute.GET(get());
    expect(await listed.json()).toEqual({ holds: [] });
  });
});
