import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, FakeAccessDeniedError, FakeRegistrationPdfError } = vi.hoisted(() => {
  class AccessDenied extends Error {
    constructor(readonly code: string, readonly status: number, message: string) {
      super(message);
    }
  }
  class PdfError extends Error {
    constructor(message: string, readonly code: "NOT_AVAILABLE" | "DOCUMENT_CORRUPT") {
      super(message);
    }
  }
  return {
    FakeAccessDeniedError: AccessDenied,
    FakeRegistrationPdfError: PdfError,
    mocks: {
      requirePermission: vi.fn(),
      requireRosterAccess: vi.fn(),
      readRegistrationPdfForDownload: vi.fn(),
      readClubRegistrationPdfForDownload: vi.fn(),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: FakeAccessDeniedError, requirePermission: mocks.requirePermission }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn().mockResolvedValue({ user: { id: "staff-1" } }) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/club-rosters/access", () => ({
  requireRosterAccess: mocks.requireRosterAccess,
  actorAttribution: (actor: { accountId: string }) => ({ accountId: actor.accountId }),
}));
vi.mock("@/modules/club-registrations/api-errors", () => ({
  clubRegistrationApiError: (error: unknown) => Response.json({ error: "CLUB_ERROR", message: (error as Error).message }, { status: 403 }),
}));
vi.mock("@/modules/registration-pdf/repository", () => ({
  RegistrationPdfError: FakeRegistrationPdfError,
  readRegistrationPdfForDownload: mocks.readRegistrationPdfForDownload,
  readClubRegistrationPdfForDownload: mocks.readClubRegistrationPdfForDownload,
}));

import { GET as staffGet } from "@/app/api/events/[eventId]/registrations/[registrationId]/pdf/route";
import { GET as directorGet } from "@/app/api/attendee/clubs/[organizationId]/events/[eventId]/registration/pdf/route";

/** Who may download the registration PDF (#1082): staff with MANAGE_REGISTRATION, and the club's own directors. */

const pdf = { bytes: Buffer.from("%PDF-1.7 synthetic"), sha256: "abc", filename: "Registration-Synthetic-Event-Club.pdf", contentType: "application/pdf", version: 2 };
const staffContext = { params: Promise.resolve({ eventId: "event-1", registrationId: "registration-1" }) };
const directorContext = { params: Promise.resolve({ organizationId: "club-1", eventId: "event-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1" } });
  mocks.requireRosterAccess.mockResolvedValue({ actor: { kind: "ATTENDEE", accountId: "account-1" } });
  mocks.readRegistrationPdfForDownload.mockResolvedValue(pdf);
  mocks.readClubRegistrationPdfForDownload.mockResolvedValue(pdf);
});

describe("staff registration PDF download (#1082)", () => {
  it("requires MANAGE_REGISTRATION on the event in the URL, and serves the stored file privately", async () => {
    const response = await staffGet(new Request("http://localhost/pdf"), staffContext);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", expect.anything());
    expect(mocks.readRegistrationPdfForDownload).toHaveBeenCalledWith("event-1", "registration-1", { userId: "staff-1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Registration-Synthetic-Event-Club.pdf"');
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-1.7 synthetic");
  });

  it("reads nothing when permission is refused", async () => {
    mocks.requirePermission.mockRejectedValue(new FakeAccessDeniedError("FORBIDDEN", 403, "No."));
    const response = await staffGet(new Request("http://localhost/pdf"), staffContext);
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.readRegistrationPdfForDownload).not.toHaveBeenCalled();
  });

  it("answers 404 for a registration with no PDF and 409 for a file that fails its hash", async () => {
    mocks.readRegistrationPdfForDownload.mockRejectedValueOnce(new FakeRegistrationPdfError("none", "NOT_AVAILABLE"));
    const missing = await staffGet(new Request("http://localhost/pdf"), staffContext);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toContain("no-store");
    mocks.readRegistrationPdfForDownload.mockRejectedValueOnce(new FakeRegistrationPdfError("corrupt", "DOCUMENT_CORRUPT"));
    expect((await staffGet(new Request("http://localhost/pdf"), staffContext)).status).toBe(409);
  });
});

describe("director registration PDF download (#1082)", () => {
  it("checks the director's access to the club first, then serves only that club's registration", async () => {
    const response = await directorGet(new Request("http://localhost/pdf?team=maple-team"), directorContext);
    expect(mocks.requireRosterAccess).toHaveBeenCalledWith("club-1", expect.any(Date), "registerForEvents");
    expect(mocks.readClubRegistrationPdfForDownload).toHaveBeenCalledWith({ organizationId: "club-1", eventId: "event-1", teamKey: "maple-team", actor: { accountId: "account-1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("reads nothing when the person does not direct the club", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new Error("Not a director of this club."));
    const response = await directorGet(new Request("http://localhost/pdf"), directorContext);
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.readClubRegistrationPdfForDownload).not.toHaveBeenCalled();
  });

  it("answers 404 when the club has no registration for the event", async () => {
    mocks.readClubRegistrationPdfForDownload.mockRejectedValueOnce(new FakeRegistrationPdfError("none", "NOT_AVAILABLE"));
    const missing = await directorGet(new Request("http://localhost/pdf"), directorContext);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toContain("no-store");
  });
});
