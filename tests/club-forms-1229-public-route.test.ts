import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1229: the public open application API. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  rateLimit: vi.fn(),
  resolve: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({ checkClubFormApplicationRateLimit: mocks.rateLimit }));
vi.mock("@/modules/club-forms/open-applications", () => ({ resolveOpenApplication: mocks.resolve, submitOpenApplication: mocks.submit }));
vi.mock("@/modules/club-rosters/access", () => ({ RosterAccessError: class extends Error {} }));
vi.mock("@/modules/club-rosters/api-errors", () => ({
  RosterBodyError: class extends Error {},
  readRosterJson: async (request: Request) => request.json(),
}));

import { GET, POST } from "@/app/api/public/club-form-applications/[templateKey]/route";
import { ClubFormError } from "@/modules/club-forms/errors";

const context = { params: Promise.resolve({ templateKey: "club_tlt_application" }) };
const allowed = { allowed: true, decisions: [] };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://events.imsda.test/api/public/club-form-applications/club_tlt_application", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const validBody = { organizationId: "club-a", idempotencyKey: "key-aaaaaaaa-0001", answers: { full_name: "Jordan Sample" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.rateLimit.mockResolvedValue(allowed);
  mocks.submit.mockResolvedValue({ submissionId: "secret-submission-id", confirmationMessage: "Thank you.", replayed: false });
});

describe("the open application API (#1229)", () => {
  it("answers a submit with only the confirmation message: no submission id, no club data", async () => {
    const response = await POST(post(validBody), context);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ ok: true, confirmationMessage: "Thank you." });
    expect(JSON.stringify(body)).not.toContain("secret-submission-id");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.submit).toHaveBeenCalledWith("club_tlt_application", expect.objectContaining({ organizationId: "club-a", idempotencyKey: "key-aaaaaaaa-0001" }));
  });

  it("refuses a cross-origin submit first", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    const response = await POST(post(validBody), context);
    expect(response.status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rate limits submit and read", async () => {
    mocks.rateLimit.mockResolvedValue({ ...allowed, allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect((await POST(post(validBody), context)).status).toBe(429);
    expect((await GET(new Request("https://events.imsda.test/x"), context)).status).toBe(429);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("caps the body size", async () => {
    expect((await POST(post(validBody, { "content-length": "400000" }), context)).status).toBe(413);
    expect((await POST(post({ ...validBody, answers: { big: "x".repeat(310_000) } }), context)).status).toBe(413);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON, or has a missing key, an unknown field, or Not listed with no name", async () => {
    expect((await POST(post("{nope"), context)).status).toBe(400);
    expect((await POST(post({ organizationId: "club-a", answers: {} }), context)).status).toBe(400);
    expect((await POST(post({ ...validBody, linkId: "x" }), context)).status).toBe(400);
    expect((await POST(post({ ...validBody, organizationId: "NOT_LISTED" }), context)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("maps a refused club to 400, a form that is off or closed to 409, and an unknown form to 404", async () => {
    mocks.submit.mockRejectedValueOnce(new ClubFormError("VALIDATION_FAILED", "Choose your club from the list."));
    expect((await POST(post(validBody), context)).status).toBe(400);
    mocks.submit.mockRejectedValueOnce(new ClubFormError("APPLICATION_OFF", "Not available yet."));
    expect((await POST(post(validBody), context)).status).toBe(409);
    mocks.submit.mockRejectedValueOnce(new ClubFormError("APPLICATION_CLOSED", "Applications are closed for this club year."));
    expect((await POST(post(validBody), context)).status).toBe(409);
    mocks.submit.mockRejectedValueOnce(new ClubFormError("TEMPLATE_NOT_FOUND", "That form isn't available."));
    expect((await POST(post(validBody), context)).status).toBe(404);
  });

  it("serves the form to read with private headers, and a 404 for an unknown form", async () => {
    mocks.resolve.mockResolvedValueOnce({ status: "OPEN", clubs: [{ id: "club-a", name: "Example Pathfinders" }] });
    const ok = await GET(new Request("https://events.imsda.test/x"), context);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toContain("no-store");
    mocks.resolve.mockRejectedValueOnce(new ClubFormError("TEMPLATE_NOT_FOUND", "That form isn't available."));
    expect((await GET(new Request("https://events.imsda.test/x"), context)).status).toBe(404);
  });
});
