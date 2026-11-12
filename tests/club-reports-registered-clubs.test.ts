import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  requireClubReportsAccess: vi.fn(),
  getCheckInBookData: vi.fn(),
  createDirectorClubPass: vi.fn(),
  isClubRegisteredForEvent: vi.fn(),
  grant: vi.fn().mockResolvedValue(null),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/reporting/export-scope", () => ({ eventFileScope: vi.fn().mockResolvedValue("event") }));
vi.mock("@/modules/reporting/check-in-book-repository", () => ({ getCheckInBookData: mocks.getCheckInBookData }));
vi.mock("@/modules/reporting/check-in-book", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/reporting/check-in-book")>();
  return { ...actual, checkInBookCsv: () => "csv" };
});
vi.mock("@/modules/checkin/club-pass-repository", () => ({ createDirectorClubPass: mocks.createDirectorClubPass }));
vi.mock("@/modules/club-rosters/event-oversight", () => ({
  isClubRegisteredForEvent: mocks.isClubRegisteredForEvent,
  resolveClubOversight: vi.fn(),
}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubsAdministratorGrant: { findFirst: mocks.grant } }) }));
vi.mock("@/modules/reporting/club-reports-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/reporting/club-reports-access")>();
  return { ...actual, requireClubReportsAccess: mocks.requireClubReportsAccess };
});

import { GET as checkInBook } from "@/app/api/events/[eventId]/check-in-book/route";
import { GET as clubPassQr } from "@/app/api/events/[eventId]/clubs/[organizationId]/club-pass/qr/route";
import { canOpenClubForReports, limitedToRegisteredClubs } from "@/modules/reporting/club-reports-access";

const access = (registeredClubsOnly: boolean) => ({ user: { id: "user-1" }, permissions: ["VIEW_REPORTS"], registeredClubsOnly });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCheckInBookData.mockResolvedValue({ book: {} });
});

describe("who is narrowed to registered clubs", () => {
  it("narrows an event administrator only", async () => {
    await expect(limitedToRegisteredClubs({ globalRole: "STAFF" }, { role: "EVENT_ADMIN" })).resolves.toBe(true);
    await expect(limitedToRegisteredClubs({ globalRole: "SYSTEM_ADMIN" }, { role: "EVENT_ADMIN" })).resolves.toBe(false);
    await expect(limitedToRegisteredClubs({ globalRole: "STAFF" }, { role: "EVENT_ADMIN", viaClubsAdministrator: true })).resolves.toBe(false);
    await expect(limitedToRegisteredClubs({ globalRole: "STAFF" }, { role: "REGISTRATION_MANAGER" })).resolves.toBe(false);
    await expect(limitedToRegisteredClubs({ globalRole: "STAFF" }, null)).resolves.toBe(false);
  });

  it("checks the registration only for a narrowed viewer", async () => {
    mocks.isClubRegisteredForEvent.mockResolvedValue(false);
    await expect(canOpenClubForReports({ registeredClubsOnly: true }, "event-1", "club-9")).resolves.toBe(false);
    await expect(canOpenClubForReports({ registeredClubsOnly: false }, "event-1", "club-9")).resolves.toBe(true);
    expect(mocks.isClubRegisteredForEvent).toHaveBeenCalledTimes(1);
  });
});

describe("check-in book export", () => {
  const url = "http://localhost/x?status=WAITLISTED&status=CANCELLED&status=CONFIRMED";
  const context = { params: Promise.resolve({ eventId: "event-1" }) };

  it("gives an event administrator only registered (submitted or confirmed) clubs", async () => {
    mocks.requireClubReportsAccess.mockResolvedValue(access(true));
    await checkInBook(new Request(url), context);
    expect(mocks.getCheckInBookData.mock.calls[0][1]).toMatchObject({ statuses: ["CONFIRMED"] });
  });

  it("leaves other viewers' choice of statuses alone", async () => {
    mocks.requireClubReportsAccess.mockResolvedValue(access(false));
    await checkInBook(new Request(url), context);
    expect(mocks.getCheckInBookData.mock.calls[0][1]).toMatchObject({ statuses: ["CONFIRMED", "WAITLISTED", "CANCELLED"] });
  });
});

describe("staff club pass QR", () => {
  const context = { params: Promise.resolve({ eventId: "event-1", organizationId: "club-9" }) };

  it("refuses a club that is not registered for the event, for an event administrator", async () => {
    mocks.requireClubReportsAccess.mockResolvedValue(access(true));
    mocks.isClubRegisteredForEvent.mockResolvedValue(false);
    const response = await clubPassQr(new Request("http://localhost/x?team="), context);
    expect(response.status).toBe(404);
    expect(mocks.createDirectorClubPass).not.toHaveBeenCalled();
  });

  it("does not narrow a viewer who is not an event administrator", async () => {
    mocks.requireClubReportsAccess.mockResolvedValue(access(false));
    mocks.createDirectorClubPass.mockResolvedValue(null);
    await clubPassQr(new Request("http://localhost/x?team="), context);
    expect(mocks.isClubRegisteredForEvent).not.toHaveBeenCalled();
    expect(mocks.createDirectorClubPass).toHaveBeenCalled();
  });
});
