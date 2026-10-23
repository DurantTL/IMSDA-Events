import { beforeEach, describe, expect, it, vi } from "vitest";

/** #977: only a system administrator reaches the pastor-contact route; the service is mocked. Synthetic data only. */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  requireSystemAdministrator: vi.fn(),
  setPastorContact: vi.fn(),
  endPastorContact: vi.fn(),
}));
vi.mock("@/modules/organizations/access", () => ({ requireSystemAdministrator: mocks.requireSystemAdministrator }));
vi.mock("@/modules/organizations/contacts-repository", async () => {
  class OrganizationContactError extends Error {
    constructor(message: string, public readonly code: string) { super(message); }
  }
  return { OrganizationContactError, setPastorContact: mocks.setPastorContact, endPastorContact: mocks.endPastorContact };
});

import { POST } from "@/app/api/admin/organizations/[organizationId]/pastor-contact/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { OrganizationContactError } from "@/modules/organizations/contacts-repository";

const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
const context = (organizationId = "church-1") => ({ params: Promise.resolve({ organizationId }) });
const post = (body: unknown, origin: string | null = "https://events.imsda.test") =>
  new Request("https://events.imsda.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://events.imsda.test");
  mocks.requireSystemAdministrator.mockResolvedValue(admin);
  mocks.setPastorContact.mockResolvedValue({ id: "pastor-1", replaced: false });
  mocks.endPastorContact.mockResolvedValue({ changed: true });
});

describe("pastor contact route", () => {
  it("creates a contact for the church in the URL as the signed-in administrator", async () => {
    const response = await POST(post({ action: "set", contact: { name: "Pat Pastor" } }), context("church-7"));
    expect(response.status).toBe(201);
    expect(mocks.setPastorContact).toHaveBeenCalledWith({
      organizationId: "church-7",
      contact: { name: "Pat Pastor", email: null, phone: null },
      actor: { id: "admin-1", globalRole: "SYSTEM_ADMIN" },
    });
  });

  it("ends a contact", async () => {
    const response = await POST(post({ action: "end", contactId: "pastor-1", reason: "Retired." }), context());
    expect(response.status).toBe(200);
    expect(mocks.endPastorContact).toHaveBeenCalledWith({ organizationId: "church-1", contactId: "pastor-1", reason: "Retired.", actor: admin });
  });

  it("refuses a non-administrator before reading the body or touching the service", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    const response = await POST(post({ action: "set", contact: { name: "Pat" } }), context());
    expect(response.status).toBe(403);
    expect(mocks.setPastorContact).not.toHaveBeenCalled();
    expect(mocks.endPastorContact).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("Sign in.", 401, "AUTHENTICATION_REQUIRED"));
    expect((await POST(post({ action: "end", contactId: "x" }), context())).status).toBe(401);
    expect(mocks.endPastorContact).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    const response = await POST(post({ action: "set", contact: { name: "Pat" } }, "https://evil.example"), context());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.setPastorContact).not.toHaveBeenCalled();
  });

  it("rejects bad input with 400 and maps service errors without leaking other contacts", async () => {
    expect((await POST(post({ action: "set", contact: { name: "" } }), context())).status).toBe(400);
    expect((await POST(post({ action: "set", contact: { name: "Pat", email: "nope" } }), context())).status).toBe(400);
    mocks.setPastorContact.mockRejectedValueOnce(new OrganizationContactError("Someone else just changed this contact. Reload and try again.", "CONCURRENT_CHANGE"));
    const conflict = await POST(post({ action: "set", contact: { name: "Pat" } }), context());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "CONCURRENT_CHANGE", message: "Someone else just changed this contact. Reload and try again." });
    mocks.endPastorContact.mockRejectedValueOnce(new OrganizationContactError("That pastor contact is no longer active.", "CONTACT_NOT_FOUND"));
    expect((await POST(post({ action: "end", contactId: "gone" }), context())).status).toBe(404);
  });
});
