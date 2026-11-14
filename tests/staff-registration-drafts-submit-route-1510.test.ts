import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/modules/access/authorization";

/** The staff submit and grant routes (#1510): permissions, strict body, override gate. Synthetic data only. */
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), submit: vi.fn(), grant: vi.fn(), getCurrentSession: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/staff-registration-drafts/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/staff-registration-drafts/api")>()),
  authorizeStaffDrafts: mocks.authorize,
}));
vi.mock("@/modules/staff-registration-drafts/repository", () => ({ submitStaffDraft: mocks.submit }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/staff-registration-drafts/override-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/staff-registration-drafts/override-access")>()),
  setRegistrationOverrideAccess: mocks.grant,
}));
vi.mock("@/modules/forms/public-repository", async () => {
  class PublicRegistrationError extends Error {
    constructor(public readonly code: string, message: string, public readonly issues: unknown[] = [], public readonly meta: { overridable?: boolean } = {}) {
      super(message);
    }
    get overridable() {
      return this.meta.overridable === true;
    }
  }
  return { PublicRegistrationError };
});

import * as submit from "@/app/api/events/[eventId]/staff-registration-drafts/[draftId]/submit/route";
import { PUT as grantPut } from "@/app/api/events/[eventId]/memberships/[membershipId]/registration-override-access/route";
import { PublicRegistrationError } from "@/modules/forms/public-repository";
import { parseStaffSubmitBody } from "@/modules/staff-registration-drafts/schemas";

const params = { params: Promise.resolve({ eventId: "event-1", draftId: "draft-1" }) };
const origin = { origin: "https://events.imsda.test", host: "events.imsda.test", "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = origin) =>
  new Request("https://events.imsda.test/api/x", { method: "POST", headers, body: JSON.stringify(body) });
const valid = { versionId: "version-1", idempotencyKey: "3f2b8c1e-5a4d-4e7b-9c6a-1d2e3f4a5b6c", responses: { first_name: "Sample", email: "sample@example.test" } };
const manager = { user: { id: "staff-1", globalRole: null }, membership: { eventId: "event-1", userId: "staff-1", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] } };
const overrider = { ...manager, membership: { ...manager.membership, permissions: ["OVERRIDE_REGISTRATION_RULES"] } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue(manager);
  mocks.submit.mockResolvedValue({ confirmationCode: "REG-SYNTHETIC" });
});

describe("POST staff-registration-drafts/[draftId]/submit", () => {
  it("needs MANAGE_REGISTRATION and does nothing without it", async () => {
    mocks.authorize.mockRejectedValue(new AccessDeniedError("Your event role doesn't include this.", 403, "PERMISSION_DENIED"));
    expect((await submit.POST(post(valid), params)).status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    const response = await submit.POST(post(valid, { origin: "https://evil.example.test", host: "events.imsda.test", "content-type": "application/json" }), params);
    expect(response.status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("sends the draft without an override, as the signed-in staff user, with no-store", async () => {
    const response = await submit.POST(post({ ...valid, paperLocation: " Binder A " }), params);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.submit).toHaveBeenCalledWith("event-1", "draft-1", { userId: "staff-1", canOverride: false }, expect.objectContaining({ paperLocation: "Binder A", override: null }));
  });

  it("never returns the registrant's private registration link to staff", async () => {
    mocks.submit.mockResolvedValue({ confirmationCode: "REG-SYNTHETIC", managePath: "/manage/synthetic-token", manageLinkExpiresAt: "2027-01-01T00:00:00.000Z" });
    const response = await submit.POST(post(valid), params);
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(text).toContain("REG-SYNTHETIC");
    expect(text).not.toMatch(/managePath|manageLinkExpiresAt|synthetic-token/);
  });

  it("refuses an override without OVERRIDE_REGISTRATION_RULES (403 with a plain message) and writes nothing", async () => {
    mocks.submit.mockImplementation(async (_e: string, _d: string, actor: { canOverride: boolean }, body: { override: unknown }) => {
      if (body.override && !actor.canOverride) {
        const { StaffDraftError } = await import("@/modules/staff-registration-drafts/errors");
        throw new StaffDraftError("OVERRIDE_NOT_ALLOWED", "You don't have permission to override registration rules. Ask a system administrator.");
      }
      return {};
    });
    const response = await submit.POST(post({ ...valid, override: { reason: "Phoned after the deadline." } }), params);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toMatch(/permission to override/);
    expect(mocks.submit.mock.calls[0]![2]).toEqual({ userId: "staff-1", canOverride: false });
  });

  it("passes an override through when the user holds the permission, and for a system administrator", async () => {
    mocks.authorize.mockResolvedValue(overrider);
    expect((await submit.POST(post({ ...valid, override: { reason: "  Phoned after the deadline.  " } }), params)).status).toBe(201);
    expect(mocks.submit.mock.calls[0]![2]).toEqual({ userId: "staff-1", canOverride: true });
    expect(mocks.submit.mock.calls[0]![3]).toMatchObject({ override: { reason: "Phoned after the deadline." } });
    mocks.authorize.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" }, membership: null });
    await submit.POST(post({ ...valid, override: { reason: "Phoned after the deadline." } }), params);
    expect(mocks.submit.mock.calls[1]![2]).toEqual({ userId: "admin-1", canOverride: true });
  });

  it("is strict: a link token, a source, a short or long reason and unknown keys are refused", async () => {
    for (const body of [
      { ...valid, staffDraftToken: "token" },
      { ...valid, source: "PAPER" },
      { ...valid, override: { reason: "short" } },
      { ...valid, override: { reason: "x".repeat(501) } },
      { ...valid, override: { reason: "A long enough reason.", extra: 1 } },
      { ...valid, unknown: 1 },
      { ...valid, idempotencyKey: "not-a-uuid" },
    ]) {
      expect((await submit.POST(post(body), params)).status).toBe(400);
    }
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(() => parseStaffSubmitBody([])).toThrow();
    expect(parseStaffSubmitBody(valid)).toMatchObject({ paperLocation: null, override: null });
  });

  it("maps a refusal like the public route and says when it can be overridden", async () => {
    mocks.submit.mockRejectedValueOnce(new PublicRegistrationError("REGISTRATION_CLOSED", "Registration for this event is closed.", [], { overridable: true }));
    const closed = await submit.POST(post(valid), params);
    expect(closed.status).toBe(410);
    expect(await closed.json()).toMatchObject({ error: "REGISTRATION_CLOSED", overridable: true });
    mocks.submit.mockRejectedValueOnce(new PublicRegistrationError("EVENT_FULL", "Full."));
    const full = await submit.POST(post(valid), params);
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: "EVENT_FULL", overridable: false });
    mocks.submit.mockRejectedValueOnce(new PublicRegistrationError("INVALID_SUBMISSION", "Review.", []));
    expect((await submit.POST(post(valid), params)).status).toBe(422);
  });
});

describe("PUT .../memberships/[membershipId]/registration-override-access", () => {
  const grantContext = { params: Promise.resolve({ eventId: "event-1", membershipId: "m1" }) };
  const put = (body: unknown, headers = origin) => new Request("https://events.imsda.test/api/x", { method: "PUT", headers, body: JSON.stringify(body) });

  it("only a system administrator grants or revokes it, as themselves", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    mocks.grant.mockResolvedValue({ granted: true, changed: true });
    expect((await grantPut(put({ granted: true }), grantContext)).status).toBe(200);
    expect(mocks.grant).toHaveBeenCalledWith("event-1", "m1", "admin-1", true);
    expect((await grantPut(put({ granted: "yes" }), grantContext)).status).toBe(400);
  });

  it("refuses an Event Admin, anonymous and cross-origin requests, and writes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: null } });
    expect((await grantPut(put({ granted: true }), grantContext)).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await grantPut(put({ granted: true }), grantContext)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    expect((await grantPut(put({ granted: true }, { origin: "https://evil.example.test", host: "events.imsda.test", "content-type": "application/json" }), grantContext)).status).toBe(403);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
});
