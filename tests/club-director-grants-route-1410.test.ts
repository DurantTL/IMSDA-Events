import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDirectorGrant: vi.fn(),
  processAccountEmailQueue: vi.fn(),
  after: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/organizations/access", () => ({ requireClubOrganizationAdministration: async () => ({ id: "user-1" }) }));
vi.mock("@/modules/organizations/director-grants-repository", () => ({
  createDirectorGrant: mocks.createDirectorGrant,
  listDirectorGrants: vi.fn(),
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));

import { POST } from "@/app/api/admin/organizations/[organizationId]/director-grants/route";

const call = () => POST(new Request("https://events.imsda.test/api/admin/organizations/club-1/director-grants", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: JSON.stringify({ email: "quinn@example.test", role: "DIRECTOR", reason: "Board vote" }),
}), { params: Promise.resolve({ organizationId: "club-1" }) });

beforeEach(() => vi.clearAllMocks());

describe("POST director-grants (#1410)", () => {
  it("returns names and a yes or no for the notice, never the message id or account id, and delivers the one email after the response", async () => {
    mocks.createDirectorGrant.mockResolvedValue({
      club: { id: "club-1" }, grants: [],
      given: { accountId: "acct-secret-id", displayName: "Quinn Rivers", email: "quinn@example.test", twoStepOn: false, messageId: "message-1" },
    });
    const response = await call();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.granted).toEqual({ displayName: "Quinn Rivers", email: "quinn@example.test", twoStepOn: false, emailQueued: true });
    expect(JSON.stringify(body)).not.toContain("message-1");
    expect(JSON.stringify(body)).not.toContain("acct-secret-id");
    await (mocks.after.mock.calls[0][0] as () => Promise<void>)();
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["message-1"], limit: 1 });
  });

  it("delivers nothing and says so where no email was queued", async () => {
    mocks.createDirectorGrant.mockResolvedValue({
      club: { id: "club-1" }, grants: [],
      given: { accountId: "a", displayName: "Quinn Rivers", email: "quinn@example.test", twoStepOn: true, messageId: null },
    });
    const body = await (await call()).json();
    expect(body.granted).toMatchObject({ twoStepOn: true, emailQueued: false });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
