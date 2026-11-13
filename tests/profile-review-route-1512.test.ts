import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  getCurrentAttendee: vi.fn(),
  attendeeSignInStepPending: vi.fn(),
  getRegistrationProfileReview: vi.fn(),
  applyRegistrationProfileReview: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSignInStepPending: mocks.attendeeSignInStepPending }));
vi.mock("@/modules/attendee-accounts/profile-review-service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/attendee-accounts/profile-review-service")>(
    "@/modules/attendee-accounts/profile-review-service",
  );
  return {
    applyReviewSchema: actual.applyReviewSchema,
    ProfileReviewError: actual.ProfileReviewError,
    getRegistrationProfileReview: mocks.getRegistrationProfileReview,
    applyRegistrationProfileReview: mocks.applyRegistrationProfileReview,
  };
});

import { GET, POST } from "@/app/api/attendee/profile/registration-review/route";
import { ProfileReviewError } from "@/modules/attendee-accounts/profile-review-service";

const version = "a".repeat(64);
const attendee = { id: "acct-1", verifiedEmail: "avery@example.test", displayName: "Avery Person" };
const getRequest = (query = "?registrationId=reg-1") =>
  new Request(`https://events.imsda.test/api/attendee/profile/registration-review${query}`);
const postRequest = (body: unknown = { registrationId: "reg-1", fields: ["firstName"], version }) =>
  new Request("https://events.imsda.test/api/attendee/profile/registration-review", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const callGet = (request = getRequest()) => (GET as unknown as (r: Request) => Promise<Response>)(request);
const callPost = (request = postRequest()) => (POST as unknown as (r: Request) => Promise<Response>)(request);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.attendeeSignInStepPending.mockResolvedValue(false);
  mocks.getCurrentAttendee.mockResolvedValue({ account: attendee, via: "attendee", sessionId: "sess-1" });
  mocks.getRegistrationProfileReview.mockResolvedValue({ registrationId: "reg-1", version, conflicts: [] });
  mocks.applyRegistrationProfileReview.mockResolvedValue({ applied: ["firstName"] });
});

describe("GET registration review", () => {
  it("returns the review with private headers", async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ review: { registrationId: "reg-1", version, conflicts: [] } });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(mocks.getRegistrationProfileReview).toHaveBeenCalledWith(attendee, "reg-1");
  });

  it("answers 401 with no account, and for a staff session acting as an attendee", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await callGet()).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account: attendee, via: "staff", sessionId: null });
    expect((await callGet()).status).toBe(401);
    expect(mocks.getRegistrationProfileReview).not.toHaveBeenCalled();
  });

  it("answers 403 SECOND_STEP_REQUIRED before reading anything", async () => {
    mocks.attendeeSignInStepPending.mockResolvedValue(true);
    const response = await callGet();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("SECOND_STEP_REQUIRED");
    expect(mocks.getRegistrationProfileReview).not.toHaveBeenCalled();
  });

  it("answers 404 for a registration the account may not see, and for a missing id", async () => {
    mocks.getRegistrationProfileReview.mockResolvedValue(null);
    expect((await callGet()).status).toBe(404);
    expect((await callGet(getRequest(""))).status).toBe(404);
  });
});

describe("POST registration review", () => {
  it("applies the chosen fields", async () => {
    const response = await callPost();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: ["firstName"] });
    expect(mocks.applyRegistrationProfileReview).toHaveBeenCalledWith(attendee, { registrationId: "reg-1", fields: ["firstName"], version });
  });

  it("checks the origin first", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await callPost()).status).toBe(403);
    expect(mocks.getCurrentAttendee).not.toHaveBeenCalled();
    expect(mocks.applyRegistrationProfileReview).not.toHaveBeenCalled();
  });

  it("answers 401 and 403 before reading the body", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await callPost()).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account: attendee, via: "attendee", sessionId: "sess-1" });
    mocks.attendeeSignInStepPending.mockResolvedValue(true);
    const request = postRequest();
    const parse = vi.spyOn(request, "json");
    expect((await callPost(request)).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.applyRegistrationProfileReview).not.toHaveBeenCalled();
  });

  it("answers 409 when the review is stale", async () => {
    mocks.applyRegistrationProfileReview.mockRejectedValue(new ProfileReviewError("STALE", "Review again."));
    const response = await callPost();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "STALE", message: "Review again." });
  });

  it("answers 404 for a registration the account may not see", async () => {
    mocks.applyRegistrationProfileReview.mockRejectedValue(new ProfileReviewError("NOT_FOUND", "nope"));
    expect((await callPost()).status).toBe(404);
  });

  it("rejects unknown fields, health fields, extra keys, new values and a bad version with 400", async () => {
    for (const body of [
      { registrationId: "reg-1", fields: ["dietaryNeeds"], version },
      { registrationId: "reg-1", fields: ["email"], version },
      { registrationId: "reg-1", fields: [], version },
      { registrationId: "reg-1", fields: ["firstName"], version: "short" },
      { registrationId: "reg-1", fields: ["firstName"], version, values: { firstName: "Injected" } },
    ]) {
      expect((await callPost(postRequest(body))).status).toBe(400);
    }
    expect(mocks.applyRegistrationProfileReview).not.toHaveBeenCalled();
  });
});
