import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #169: only MANAGE_FINANCE on the event in the URL may read rules, save a version or run a preview; another event is
 * refused before the service is touched; cross-origin requests are rejected; the staff page shows the restricted
 * notice and loads nothing. The service is mocked (rules: cancellation-policy-169.test.ts; database:
 * scripts/verify-cancellation-policy.ts). Synthetic data only.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirected"); }), useRouter: () => ({ refresh: vi.fn() }) }));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  resolveEventContext: vi.fn(),
  service: {
    listPolicyVersions: vi.fn(),
    createPolicyVersion: vi.fn(),
    previewCancellation: vi.fn(),
  },
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }), isServerEnvironmentError: () => false }));
vi.mock("@/modules/event-content/repository", async () => {
  const { bundledEventContent } = await import("@/modules/event-content/seeded-data");
  return {
    listCancellationPresetOptions: async () => bundledEventContent.flatMap((seed) => seed.kind === "CANCELLATION_PRESET" ? [{ key: seed.key, label: seed.content.label, description: seed.content.description, content: seed.content }] : []),
  };
});
vi.mock("@/modules/cancellation-policy/repository", async () => {
  const { z } = await import("zod");
  class CancellationPolicyError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    CancellationPolicyError,
    createPolicyVersionSchema: z.object({ rules: z.unknown(), effectiveFrom: z.string().optional(), note: z.string().optional() }).strict(),
    previewRequestSchema: z.object({ input: z.object({ kind: z.string() }).passthrough(), selection: z.object({ scope: z.string() }).passthrough(), asOf: z.string().optional() }).strict(),
    ...mocks.service,
  };
});

import { GET, POST } from "@/app/api/events/[eventId]/cancellation-policy/route";
import { POST as previewPost } from "@/app/api/events/[eventId]/cancellation-policy/preview/route";
import CancellationPolicyPage from "@/app/(workspace)/finance/cancellation-policy/page";
import { CancellationPolicyError } from "@/modules/cancellation-policy/repository";

const finance = { id: "user-finance", globalRole: null, email: "finance@example.test", displayName: "Finance" };
const context = (eventId = "event-a") => ({ params: Promise.resolve({ eventId }) });

function post(body: unknown, origin: string | null = "https://events.imsda.test") {
  return new Request("https://events.imsda.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

/** Finance manager on event A, a registration manager (no finance) on event B, read-only on event C. */
function memberships(userId: string, eventId: string) {
  if (eventId === "event-a") return { eventId, userId, role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] };
  if (eventId === "event-b") return { eventId, userId, role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] };
  if (eventId === "event-c") return { eventId, userId, role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] };
  return null;
}

const preview = { input: { kind: "SYNTHETIC" }, selection: { scope: "FULL_REGISTRATION" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: finance });
  mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => memberships(userId, eventId));
  mocks.service.listPolicyVersions.mockResolvedValue({ versions: [], inEffectVersionId: null });
  mocks.service.createPolicyVersion.mockResolvedValue({ id: "v1", version: 1, effectiveFrom: "2028-01-01T00:00:00.000Z" });
  mocks.service.previewCancellation.mockResolvedValue({ result: { status: "CALCULATED" }, registration: null, recorded: false });
});

describe("cancellation policy routes", () => {
  it("lets a finance manager read, save and preview for their event, as themselves", async () => {
    expect((await GET(post({}), context())).status).toBe(200);
    expect(mocks.service.listPolicyVersions).toHaveBeenCalledWith("event-a");
    const saved = await POST(post({ rules: { windows: [] }, actorUserId: undefined }), context());
    expect(saved.status).toBe(201);
    expect(mocks.service.createPolicyVersion).toHaveBeenCalledWith("event-a", "user-finance", { rules: { windows: [] } });
    const result = await previewPost(post(preview), context());
    expect(result.status).toBe(200);
    expect(mocks.service.previewCancellation).toHaveBeenCalledWith("event-a", preview);
  });

  it("refuses anyone without MANAGE_FINANCE on this event before the service is touched", async () => {
    for (const eventId of ["event-b", "event-c", "event-unknown"]) {
      expect((await GET(post({}), context(eventId))).status).toBe(403);
      expect((await POST(post({ rules: {} }), context(eventId))).status).toBe(403);
      expect((await previewPost(post(preview), context(eventId))).status).toBe(403);
    }
    expect(mocks.service.listPolicyVersions).not.toHaveBeenCalled();
    expect(mocks.service.createPolicyVersion).not.toHaveBeenCalled();
    expect(mocks.service.previewCancellation).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await POST(post({ rules: {} }), context())).status).toBe(401);
    expect((await previewPost(post(preview), context())).status).toBe(401);
    expect(mocks.service.previewCancellation).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and origin-less mutations", async () => {
    for (const origin of ["https://evil.example", null]) {
      expect((await POST(post({ rules: {} }, origin), context())).status).toBe(403);
      expect((await previewPost(post(preview, origin), context())).status).toBe(403);
    }
    expect(mocks.service.createPolicyVersion).not.toHaveBeenCalled();
    expect(mocks.service.previewCancellation).not.toHaveBeenCalled();
  });

  it("answers invalid input with 400 and a missing registration with 404", async () => {
    expect((await previewPost(post({ nonsense: true }), context())).status).toBe(400);
    mocks.service.previewCancellation.mockRejectedValueOnce(new CancellationPolicyError("REGISTRATION_NOT_FOUND", "That registration could not be found in this event."));
    const missing = await previewPost(post(preview), context());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "REGISTRATION_NOT_FOUND" });
    mocks.service.createPolicyVersion.mockRejectedValueOnce(new CancellationPolicyError("EFFECTIVE_DATE_IN_PAST", "A new version cannot take effect in the past."));
    expect((await POST(post({ rules: {} }), context())).status).toBe(400);
  });
});

describe("cancellation policy page", () => {
  const event = { id: "event-a", name: "Synthetic Camp", timezone: "America/Chicago" };

  it("shows the restricted notice and loads nothing without MANAGE_FINANCE", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT", "CONFIGURE_EVENT"] });
    const markup = renderToStaticMarkup(await CancellationPolicyPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Finance is restricted");
    expect(mocks.service.listPolicyVersions).not.toHaveBeenCalled();
  });

  it("renders the rules, the new-version tool and the preview for a finance manager, and says nothing is changed", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT", "MANAGE_FINANCE"] });
    const markup = renderToStaticMarkup(await CancellationPolicyPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Cancellation rules");
    expect(markup).toContain("Preview an outcome");
    expect(markup).toContain("Nothing here cancels a registration, refunds money or creates credit");
    expect(markup).toContain("No rules have been saved for this event yet");
    // The Camp Meeting starting rule comes from seeded data (#919), with its own words.
    expect(markup).toContain("Camp Meeting rule: deadline date");
    expect(markup).toContain("Start from the Camp Meeting rule");
    expect(markup).toContain("a full refund minus a $10 processing fee");
    expect(mocks.service.listPolicyVersions).toHaveBeenCalledWith("event-a");
  });
});
