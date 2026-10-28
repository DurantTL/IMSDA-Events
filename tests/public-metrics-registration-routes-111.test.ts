import { beforeEach, describe, expect, it, vi } from "vitest";

/** #111: group and general-link registrations are counted per event on success only, and not under Global Privacy Control. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  submitGroupRegistration: vi.fn(),
  submitGeneralLinkRegistration: vi.fn(),
  recordPublicMetric: vi.fn(),
}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/rate-limit/service", () => ({ checkPublicRegistrationRateLimit: async () => ({ allowed: true, decisions: [] }) }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: async () => ({}) }));
vi.mock("next/server", () => ({ after: () => { throw new Error("outside a request"); } }));
vi.mock("@/modules/public-metrics/repository", () => ({ recordPublicMetric: mocks.recordPublicMetric }));
vi.mock("@/modules/group-registrations/repository", async () => ({
  ...(await vi.importActual<object>("@/modules/group-registrations/repository")),
  submitGroupRegistration: mocks.submitGroupRegistration,
}));
vi.mock("@/modules/general-link-registrations/repository", async () => ({
  ...(await vi.importActual<object>("@/modules/general-link-registrations/repository")),
  submitGeneralLinkRegistration: mocks.submitGeneralLinkRegistration,
}));

import { POST as groupPost } from "@/app/api/public/events/[eventSlug]/group-registrations/route";
import { POST as generalPost } from "@/app/api/public/events/[eventSlug]/general-registrations/route";

const ctx = { params: Promise.resolve({ eventSlug: "honors-weekend" }) };
const submission = {
  versionId: "v1",
  idempotencyKey: "5b1f6f3e-7f3a-4c3e-9a6a-0a3a4d5e6f71",
  responses: { email: "contact@example.test" },
  attendees: [{ clientId: "p1", responses: { first_name: "Alex", attendee_age: "12" } }],
  website: "",
};
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://events.imsda.test/api/x", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const routes = [
  { name: "group", post: groupPost, submit: mocks.submitGroupRegistration },
  { name: "general-link", post: generalPost, submit: mocks.submitGeneralLinkRegistration },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordPublicMetric.mockResolvedValue(true);
  mocks.submitGroupRegistration.mockResolvedValue({ confirmationCode: "REG-1" });
  mocks.submitGeneralLinkRegistration.mockResolvedValue({ confirmationCode: "REG-2" });
});

describe.each(routes)("$name registration route counts", ({ post, submit }) => {
  it("a completed registration, by event only", async () => {
    const response = await post(request(submission), ctx);
    expect(response.status).toBe(201);
    await flush();
    expect(mocks.recordPublicMetric.mock.calls).toEqual([["REGISTRATION_COMPLETE", "honors-weekend"]]);
  });

  it("nothing under Global Privacy Control, and the answer is the same", async () => {
    const response = await post(request(submission, { "sec-gpc": "1" }), ctx);
    expect(response.status).toBe(201);
    await flush();
    expect(mocks.recordPublicMetric).not.toHaveBeenCalled();
  });

  it("nothing when the registration fails or the body is refused", async () => {
    submit.mockRejectedValueOnce(new Error("synthetic failure"));
    expect((await post(request(submission), ctx)).status).toBeGreaterThanOrEqual(400);
    expect((await post(request("not json"), ctx)).status).toBeGreaterThanOrEqual(400);
    await flush();
    expect(mocks.recordPublicMetric).not.toHaveBeenCalled();
  });
});
