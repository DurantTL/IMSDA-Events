import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  repo: {
    requireSnapshotAdminViewer: vi.fn(),
    listSnapshotBreakGlassGrants: vi.fn(),
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
vi.mock("@/modules/health-records/snapshot-access-repository", () => state.repo);

import * as breakGlassRoute from "@/app/api/staff/health-snapshots/break-glass/route";
import * as personRoute from "@/app/api/staff/health-snapshots/person/[personId]/route";
import * as grantsRoute from "@/app/api/staff/health-snapshots/break-glass-grants/route";
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
  state.repo.requireSnapshotAdminViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
});

describe("with the health records switch off", () => {
  it("answers break-glass and viewing like an unknown route, before reading a body or a session", async () => {
    state.enabled = false;
    const responses = await Promise.all([
      breakGlassRoute.POST(post({ personId: "person-1", reason: REASON })),
      personRoute.GET(get(), ctx),
    ]);
    for (const response of responses) expect(response.status).toBe(404);
    expect(state.repo.requireSnapshotAdminViewer).not.toHaveBeenCalled();
    expect(state.repo.startSnapshotBreakGlass).not.toHaveBeenCalled();
    expect(state.repo.viewSealedSnapshots).not.toHaveBeenCalled();
  });

  it("keeps the hold routes and the break-glass review list available to a system administrator", async () => {
    state.enabled = false;
    state.repo.placeSnapshotHold.mockResolvedValue({ holdId: "hold-1", alreadyHeld: false, snapshotsCovered: 1 });
    state.repo.liftSnapshotHold.mockResolvedValue({ holdId: "hold-1" });
    state.repo.listSnapshotHolds.mockResolvedValue([]);
    state.repo.listSnapshotBreakGlassGrants.mockResolvedValue([]);
    expect((await holdsRoute.POST(post({ scope: "PERSON", personId: "person-1", reason: REASON }))).status).toBe(200);
    expect((await holdsRoute.GET(get())).status).toBe(200);
    expect((await liftRoute.POST(post({ reason: REASON }), ctx)).status).toBe(200);
    expect((await grantsRoute.GET(get())).status).toBe(200);
    for (const call of state.repo.requireSnapshotAdminViewer.mock.calls) expect(call[2]).toMatchObject({ flagOptional: true });
  });

  it("answers anyone but a system administrator like an unknown route on those routes", async () => {
    state.enabled = false;
    state.repo.requireSnapshotAdminViewer.mockRejectedValue(new HealthRecordError("NOT_FOUND", "That page could not be found."));
    expect((await holdsRoute.GET(get())).status).toBe(404);
    expect((await grantsRoute.GET(get())).status).toBe(404);
  });
});

describe("who is asked before the body is read", () => {
  it("refuses a malformed body from someone who may not do this as unauthorized, not as a bad request", async () => {
    state.repo.requireSnapshotAdminViewer.mockRejectedValue(new HealthRecordError("FORBIDDEN", "Sealed health copies can be opened only by a system administrator, with break-glass."));
    const malformed = () => new Request("https://events.imsda.test/api/staff/health-snapshots", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
      body: "{not json",
    });
    const responses = await Promise.all([
      breakGlassRoute.POST(malformed()),
      holdsRoute.POST(malformed()),
      liftRoute.POST(malformed(), ctx),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "FORBIDDEN" });
    }
    expect(state.repo.startSnapshotBreakGlass).not.toHaveBeenCalled();
    expect(state.repo.placeSnapshotHold).not.toHaveBeenCalled();
    expect(state.repo.liftSnapshotHold).not.toHaveBeenCalled();
  });

  it("names the attempt and its target to the resolver, so the refusal can be audited", async () => {
    await personRoute.GET(get(), ctx);
    expect(state.repo.requireSnapshotAdminViewer).toHaveBeenLastCalledWith("VIEW_SEALED_COPIES", "person-1", { allowClubsAdministrator: true });
    await liftRoute.POST(post({ reason: REASON }), ctx);
    expect(state.repo.requireSnapshotAdminViewer).toHaveBeenLastCalledWith("LIFT_HOLD", "hold-1", { flagOptional: true });
  });
});

describe("the break-glass review list", () => {
  it("lists grants for the viewer and never carries a value", async () => {
    state.repo.listSnapshotBreakGlassGrants.mockResolvedValue([{ id: "grant-1", userId: "admin-1", userDisplayName: "Synthetic Admin", personId: "person-1", reason: REASON, grantedAt: new Date("2026-10-14T12:00:00Z"), expiresAt: new Date("2026-10-15T12:00:00Z") }]);
    const response = await grantsRoute.GET(get());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ grants: [{ id: "grant-1", userId: "admin-1", userDisplayName: "Synthetic Admin", personId: "person-1", reason: REASON, grantedAt: "2026-10-14T12:00:00.000Z", expiresAt: "2026-10-15T12:00:00.000Z" }] });
    expect(state.repo.listSnapshotBreakGlassGrants).toHaveBeenCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
  });
});

describe("break-glass and viewing", () => {
  it("starts break-glass with a typed reason and returns the grant, never a value", async () => {
    state.repo.startSnapshotBreakGlass.mockResolvedValue({ grantId: "grant-1", expiresAt: new Date("2026-10-15T12:00:00Z"), snapshotCount: 2, liveRecordCount: 1 });
    const response = await breakGlassRoute.POST(post({ personId: "person-1", reason: REASON }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, grantId: "grant-1", expiresAt: "2026-10-15T12:00:00.000Z", snapshotCount: 2, liveRecordCount: 1 });
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
