import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #399: who may prepare a church's promo code draft invoice. MANAGE_FINANCE on the event in the URL, checked on the
 * server; the actor is the signed-in user, never the body; cross-origin and malformed requests are refused before the
 * service is touched; and the route has no way to finalize or send. The service is mocked (rules:
 * church-code-invoices-domain.test.ts; real database: scripts/verify-church-code-invoices.ts). Synthetic data only.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  prepare: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }), isServerEnvironmentError: () => false }));
vi.mock("@/modules/invoices/repository", async () => {
  class InvoiceError extends Error {
    constructor(message: string, public readonly code: string, public readonly blockers: unknown[] = []) { super(message); }
  }
  return { InvoiceError, finalizeInvoiceVersion: mocks.finalize };
});
vi.mock("@/modules/promo-codes/church-invoice-repository", () => ({ prepareChurchCodeInvoiceDraft: mocks.prepare }));

import { POST } from "@/app/api/events/[eventId]/church-code-invoices/route";
import { InvoiceError } from "@/modules/invoices/repository";

const context = (eventId = "event-a") => ({ params: Promise.resolve({ eventId }) });

function request(body: unknown, origin: string | null = "https://events.imsda.test") {
  return new Request("https://events.imsda.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

const financeManager = { id: "user-finance", globalRole: null, email: "finance@example.test", displayName: "Finance" };
const readOnly = { id: "user-read", globalRole: null, email: "read@example.test", displayName: "Reader" };
const stranger = { id: "user-stranger", globalRole: null, email: "stranger@example.test", displayName: "Stranger" };

function memberships(userId: string, eventId: string) {
  if (eventId === "event-a" && userId === "user-finance") return { eventId, userId, role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] };
  if (eventId === "event-a" && userId === "user-read") return { eventId, userId, role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] };
  return null;
}

let signedIn: Record<string, unknown> | null = financeManager;
beforeEach(() => {
  vi.clearAllMocks();
  signedIn = financeManager;
  mocks.getCurrentSession.mockImplementation(async () => (signedIn ? { user: signedIn } : null));
  mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => memberships(userId, eventId));
  mocks.prepare.mockResolvedValue({ outcome: "CREATED", invoiceId: "i1", versionId: "v1", revision: 0, amountDueCents: 7500, lineCount: 2, contactChanged: false });
});

describe("POST /api/events/[eventId]/church-code-invoices", () => {
  it("lets a finance manager prepare a draft as themselves, for the event in the URL", async () => {
    const response = await POST(request({ churchId: "church-a" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "CREATED", amountDueCents: 7500 });
    expect(mocks.prepare).toHaveBeenCalledWith({ eventId: "event-a", churchId: "church-a", actorUserId: "user-finance" });
  });

  it("never takes the actor or the event from the body", async () => {
    expect((await POST(request({ churchId: "church-a", actorUserId: "someone-else" }), context())).status).toBe(400);
    expect((await POST(request({ churchId: "church-a", eventId: "event-b" }), context())).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("refuses staff without finance access, other events' staff, and the signed out, before the service is touched", async () => {
    signedIn = readOnly;
    expect((await POST(request({ churchId: "church-a" }), context())).status).toBe(403);
    signedIn = stranger;
    expect((await POST(request({ churchId: "church-a" }), context())).status).toBeGreaterThanOrEqual(400);
    signedIn = financeManager;
    expect((await POST(request({ churchId: "church-a" }), context("event-b"))).status).toBeGreaterThanOrEqual(400);
    signedIn = null;
    expect((await POST(request({ churchId: "church-a" }), context())).status).toBeGreaterThanOrEqual(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request and a malformed body", async () => {
    expect((await POST(request({ churchId: "church-a" }, "https://evil.example"), context())).status).toBe(403);
    expect((await POST(request({}), context())).status).toBe(400);
    expect((await POST(request({ churchId: "" }), context())).status).toBe(400);
    expect((await POST(request({ churchId: 5 }), context())).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("maps refusals to statuses and never finalizes", async () => {
    mocks.prepare.mockRejectedValueOnce(new InvoiceError("Nothing to invoice.", "NOTHING_TO_INVOICE"));
    expect((await POST(request({ churchId: "church-a" }), context())).status).toBe(409);
    mocks.prepare.mockRejectedValueOnce(new InvoiceError("No such organization.", "PARTY_NOT_FOUND"));
    expect((await POST(request({ churchId: "church-a" }), context())).status).toBe(404);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
});
