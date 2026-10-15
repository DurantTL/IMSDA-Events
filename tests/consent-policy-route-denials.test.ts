import { beforeEach, describe, expect, it, vi } from "vitest";

// Real authorization, fake session and membership: the denial paths are the real ones.
const dependencies = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  repository: {
    createConsentPolicy: vi.fn(),
    listConsentPoliciesForEvent: vi.fn(),
    createNextDraftVersion: vi.fn(),
    updateDraftPolicyVersion: vi.fn(),
    publishPolicyVersion: vi.fn(),
    createEventPolicyApplicability: vi.fn(),
    listEventPolicyApplicabilities: vi.fn(),
    updateEventPolicyApplicability: vi.fn(),
    listPublishedPolicyVersionsForEvent: vi.fn(),
  },
}));

vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));
vi.mock("@/modules/consent/repository", () => ({
  ConsentPolicyError: class ConsentPolicyError extends Error {},
  ...dependencies.repository,
}));

import { GET as listPolicies, POST as createPolicy } from "@/app/api/events/[eventId]/consent-policies/route";
import { POST as publishPolicy } from "@/app/api/events/[eventId]/consent-policies/[policyId]/publish/route";
import { POST as createDraft } from "@/app/api/events/[eventId]/consent-policies/[policyId]/versions/route";
import { PATCH as editVersion } from "@/app/api/events/[eventId]/consent-policies/[policyId]/versions/[versionId]/route";
import { GET as listApplicability, POST as createApplicability } from "@/app/api/events/[eventId]/consent-policy-applicability/route";
import { PATCH as editApplicability } from "@/app/api/events/[eventId]/consent-policy-applicability/[applicabilityId]/route";
import { GET as listPublishedVersions } from "@/app/api/events/[eventId]/consent-policy-versions/route";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const params = { eventId: "event-1", policyId: "policy-1", versionId: "version-1", applicabilityId: "applicability-1" };

function request(method: string) {
  return method === "GET"
    ? new Request("http://localhost/api", { method })
    : new Request("http://localhost/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
}

const fullRoutes: Array<[string, Handler, string]> = [
  ["GET consent-policies", listPolicies as Handler, "GET"],
  ["POST consent-policies", createPolicy as Handler, "POST"],
  ["POST consent-policies/{id}/publish", publishPolicy as Handler, "POST"],
  ["POST consent-policies/{id}/versions", createDraft as Handler, "POST"],
  ["PATCH consent-policies/{id}/versions/{id}", editVersion as Handler, "PATCH"],
  ["GET consent-policy-applicability", listApplicability as Handler, "GET"],
  ["POST consent-policy-applicability", createApplicability as Handler, "POST"],
  ["PATCH consent-policy-applicability/{id}", editApplicability as Handler, "PATCH"],
];

function membership(role: string, permissions: string[] = []) {
  return { eventId: "event-1", userId: "user-1", role, status: "ACTIVE", permissions };
}

function neverCalled() {
  for (const fn of Object.values(dependencies.repository)) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "user-1", email: "synthetic@example.test", displayName: "Synthetic" } });
});

describe.each(fullRoutes)("%s requires CONFIGURE_EVENT", (_name, handler, method) => {
  it("refuses an unauthenticated caller", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    const response = await handler(request(method), { params: Promise.resolve(params) });
    expect(response.status).toBe(401);
    expect(dependencies.findActiveMembership).not.toHaveBeenCalled();
    neverCalled();
  });

  it("refuses a non-member", async () => {
    dependencies.findActiveMembership.mockResolvedValue(null);
    const response = await handler(request(method), { params: Promise.resolve(params) });
    expect(response.status).toBe(403);
    neverCalled();
  });

  it("refuses an inactive member", async () => {
    dependencies.findActiveMembership.mockResolvedValue({ ...membership("EVENT_ADMIN"), status: "INACTIVE" });
    const response = await handler(request(method), { params: Promise.resolve(params) });
    expect(response.status).toBe(403);
    neverCalled();
  });

  it.each(["REGISTRATION_MANAGER", "READ_ONLY_STAFF", "COMMUNICATIONS_MANAGER"])("refuses a %s, who lacks CONFIGURE_EVENT", async (role) => {
    dependencies.findActiveMembership.mockResolvedValue(membership(role));
    const response = await handler(request(method), { params: Promise.resolve(params) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "PERMISSION_DENIED" });
    neverCalled();
  });
});

describe("GET consent-policy-versions (slim read) requires MANAGE_FORMS", () => {
  const call = () => listPublishedVersions(request("GET"), { params: Promise.resolve(params) });

  it("refuses an unauthenticated caller", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call()).status).toBe(401);
    neverCalled();
  });

  it("refuses a non-member", async () => {
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await call()).status).toBe(403);
    neverCalled();
  });

  it.each(["READ_ONLY_STAFF", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF"])("refuses a %s, who lacks MANAGE_FORMS", async (role) => {
    dependencies.findActiveMembership.mockResolvedValue(membership(role));
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "PERMISSION_DENIED" });
    neverCalled();
  });

  it("serves a member who holds MANAGE_FORMS, and only the slim read is called", async () => {
    dependencies.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER"));
    dependencies.repository.listPublishedPolicyVersionsForEvent.mockResolvedValue([{ id: "version-1" }]);
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [{ id: "version-1" }] });
    expect(dependencies.repository.listPublishedPolicyVersionsForEvent).toHaveBeenCalledWith("event-1");
    expect(dependencies.repository.listConsentPoliciesForEvent).not.toHaveBeenCalled();
  });

  it("serves an explicit MANAGE_FORMS grant on an otherwise read-only role", async () => {
    dependencies.findActiveMembership.mockResolvedValue(membership("READ_ONLY_STAFF", ["MANAGE_FORMS"]));
    dependencies.repository.listPublishedPolicyVersionsForEvent.mockResolvedValue([]);
    expect((await call()).status).toBe(200);
  });
});

describe("the full routes still serve CONFIGURE_EVENT", () => {
  it("lets an event admin list policies", async () => {
    dependencies.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    dependencies.repository.listConsentPoliciesForEvent.mockResolvedValue([]);
    expect((await listPolicies(request("GET"), { params: Promise.resolve(params) })).status).toBe(200);
  });
});
