import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1577: the station's Stop also signs the device's staff session out, through the real shared sign-out. The
 * cookie store here records what the sign-out clears; Next adds those to the response next to the station cookie.
 * Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getCurrentSession: vi.fn(),
  cookies: new Map<string, string>(),
  cookieSet: vi.fn(),
  revokeStaff: vi.fn(),
  revokeAttendee: vi.fn(),
  endActAs: vi.fn(),
  resolveStation: vi.fn(),
  stopStation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
    set: mocks.cookieSet,
  })),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: <T,>(handler: T) => handler }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: mocks.enabled }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/session-store", () => ({ revokeDatabaseSession: mocks.revokeStaff }));
vi.mock("@/modules/attendee-accounts/session-store", () => ({
  ATTENDEE_PENDING_COOKIE_NAME: "imsda_attendee_pending",
  revokeAttendeeSession: mocks.revokeAttendee,
}));
vi.mock("@/modules/organizations/staff-act-as", () => ({ endActiveActAsOnSignOut: mocks.endActAs }));
vi.mock("@/modules/events/money-lock", () => ({ EventClosedError: class extends Error {} }));
vi.mock("@/modules/payments/repository", () => ({ PaymentOperationError: class extends Error {} }));
vi.mock("@/modules/payments/square-match-repository", () => ({ SquareMatchOperationError: class extends Error {} }));
vi.mock("@/modules/checkin-stations/repository", () => ({
  resolveStation: mocks.resolveStation,
  stopStation: mocks.stopStation,
}));
vi.mock("@/modules/checkin-stations/service", () => ({ StationServiceError: class extends Error {} }));

import { POST as stopPost } from "@/app/api/check-in-station/stop/route";

const post = () => new Request("https://events.imsda.test/api/check-in-station/stop", { method: "POST" });
const clearedNames = () => mocks.cookieSet.mock.calls
  .filter(([, value, options]) => value === "" && options?.maxAge === 0)
  .map(([name]) => name)
  .sort();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.clear();
  mocks.cookies.set("imsda_session", "staff-token");
  mocks.enabled.mockResolvedValue(false);
  mocks.getCurrentSession.mockResolvedValue({ sessionId: "session_1" });
  mocks.resolveStation.mockResolvedValue({ station: { id: "station_1", eventId: "event_1" } });
  mocks.revokeStaff.mockResolvedValue(undefined);
  mocks.revokeAttendee.mockResolvedValue(undefined);
});

describe("Stop station signs the staff session out (#1577)", () => {
  it("stops the station, ends act-as, revokes this browser's staff session and clears both cookies", async () => {
    const response = await stopPost(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: true, signedOut: true });
    expect(mocks.stopStation).toHaveBeenCalledTimes(1);
    expect(mocks.endActAs).toHaveBeenCalledWith("session_1");
    expect(mocks.revokeStaff).toHaveBeenCalledWith("staff-token");
    expect(mocks.revokeAttendee).not.toHaveBeenCalled();
    expect(clearedNames()).toEqual(["__Host-imsda_session", "imsda_check_in_station", "imsda_session"]);
    expect(clearedNames()).toContain("imsda_check_in_station");
  });

  it("also ends the attendee session with one sign-in on", async () => {
    mocks.enabled.mockResolvedValue(true);
    mocks.cookies.set("imsda_attendee_session", "attendee-token");
    await stopPost(post());
    expect(mocks.revokeAttendee).toHaveBeenCalledWith("attendee-token");
    expect(clearedNames()).toContain("imsda_attendee_session");
  });

  it("still stops, clears every cookie and answers 200 when the revoke fails", async () => {
    mocks.revokeStaff.mockRejectedValue(new Error("database down"));
    const response = await stopPost(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: true, signedOut: false });
    expect(mocks.stopStation).toHaveBeenCalledTimes(1);
    expect(clearedNames()).toEqual(["__Host-imsda_session", "imsda_check_in_station", "imsda_session"]);
    expect(clearedNames()).toContain("imsda_check_in_station");
  });

  it("signs nobody out when the station was already stopped (401)", async () => {
    mocks.resolveStation.mockResolvedValue(null);
    const response = await stopPost(post());
    expect(response.status).toBe(401);
    expect(mocks.stopStation).not.toHaveBeenCalled();
    expect(mocks.revokeStaff).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
