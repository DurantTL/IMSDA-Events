import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLanding: vi.fn(),
  findForm: vi.fn(),
  getAttendee: vi.fn(),
  secondStep: vi.fn(),
  store: vi.fn(),
  rateLimit: vi.fn(),
  clientLimit: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ informationForm: { findFirst: mocks.findForm } }) }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/events/public-repository", () => ({ getPublicEventLanding: mocks.getLanding }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSignInStepPending: mocks.secondStep }));
vi.mock("@/modules/information-forms/responses", () => ({ storeInformationFormResponse: mocks.store }));
vi.mock("@/modules/rate-limit/service", () => ({ checkInformationFormRateLimit: mocks.rateLimit, checkInformationFormClientRateLimit: mocks.clientLimit }));

import { POST } from "@/app/api/public/information-forms/route";
import { InformationFormError } from "@/modules/information-forms/errors";
import { publicInformationFormPath, resolvePublicInformationForm } from "@/modules/information-forms/public";

const definition = {
  title: "Camp survey",
  description: "",
  confirmationMessage: "Thanks for telling us.",
  sections: [{ id: "section_one", title: "Questions", description: "", fields: [{ id: "field_comments", key: "comments", label: "Comments", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] }] }],
};
const now = new Date("2026-10-23T12:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return { id: "form-1", name: "Camp survey", status: "OPEN", fillAccess: "ANYONE_WITH_LINK", opensAt: null, closesAt: null, versions: [{ definition }], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.clientLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.getLanding.mockResolvedValue({ event: { name: "Sample Camporee" } });
  mocks.findForm.mockResolvedValue(row());
  mocks.getAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.secondStep.mockResolvedValue(false);
  mocks.store.mockResolvedValue({ id: "response-1", created: true });
});

describe("resolvePublicInformationForm", () => {
  it("serves an open general form", async () => {
    const view = await resolvePublicInformationForm({ slug: "camp-survey" }, now);
    expect(view).toMatchObject({ state: "OPEN", eventName: null, form: { id: "form-1", fillAccess: "ANYONE_WITH_LINK" } });
    expect(mocks.getLanding).not.toHaveBeenCalled();
    expect(mocks.findForm.mock.calls[0]![0].where).toMatchObject({ slug: "camp-survey", scope: "GENERAL", eventId: null, status: { in: ["OPEN", "CLOSED"] } });
  });

  it("checks the event is public before showing an event form", async () => {
    mocks.getLanding.mockResolvedValue(null);
    expect(await resolvePublicInformationForm({ slug: "camp-survey", eventSlug: "draft-event" }, now)).toEqual({ state: "NOT_FOUND" });
    expect(mocks.findForm).not.toHaveBeenCalled();
    mocks.getLanding.mockResolvedValue({ event: { name: "Sample Camporee" } });
    const view = await resolvePublicInformationForm({ slug: "camp-survey", eventSlug: "sample-camporee" }, now);
    expect(view).toMatchObject({ state: "OPEN", eventName: "Sample Camporee" });
    expect(mocks.findForm.mock.calls[0]![0].where).toMatchObject({ scope: "EVENT", event: { slug: "sample-camporee", isPublished: true, archivedAt: null } });
  });

  it("reports not found, not yet open and closed", async () => {
    mocks.findForm.mockResolvedValue(null);
    expect(await resolvePublicInformationForm({ slug: "nope" }, now)).toEqual({ state: "NOT_FOUND" });
    mocks.findForm.mockResolvedValue(row({ versions: [] }));
    expect(await resolvePublicInformationForm({ slug: "x" }, now)).toEqual({ state: "NOT_FOUND" });
    mocks.findForm.mockResolvedValue(row({ opensAt: new Date("2026-11-01T00:00:00Z") }));
    expect(await resolvePublicInformationForm({ slug: "x" }, now)).toMatchObject({ state: "NOT_YET_OPEN" });
    mocks.findForm.mockResolvedValue(row({ closesAt: new Date("2026-10-01T00:00:00Z") }));
    expect(await resolvePublicInformationForm({ slug: "x" }, now)).toMatchObject({ state: "CLOSED" });
    mocks.findForm.mockResolvedValue(row({ status: "CLOSED" }));
    expect(await resolvePublicInformationForm({ slug: "x" }, now)).toMatchObject({ state: "CLOSED" });
  });

  it("builds the public paths", () => {
    expect(publicInformationFormPath({ slug: "a" })).toBe("/forms/a");
    expect(publicInformationFormPath({ slug: "a", eventSlug: "e" })).toBe("/events/e/forms/a");
  });
});

const url = "https://events.example.test/api/public/information-forms";
const post = (body: unknown) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return POST(new Request(url, { method: "POST", body: text, headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)) } }));
};
const valid = { slug: "camp-survey", idempotencyKey: "key-12345678", answers: { comments: "synthetic answer" } };

describe("POST /api/public/information-forms", () => {
  it("stores an anonymous answer against the form the address resolves to", async () => {
    mocks.findForm.mockResolvedValue(row());
    const response = await post(valid);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, confirmationMessage: "Thanks for telling us." });
    expect(mocks.store).toHaveBeenCalledWith({ formId: "form-1", idempotencyKey: "key-12345678", answers: { comments: "synthetic answer" }, attendeeAccountId: null });
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(Request), "general:camp-survey", "submit");
  });

  it("passes only the verified session account, never one from the body, and only for a signed-in form", async () => {
    mocks.findForm.mockResolvedValue(row({ fillAccess: "SIGNED_IN" }));
    expect((await post({ ...valid, attendeeAccountId: "someone-else" })).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
    mocks.getAttendee.mockResolvedValue({ account: { id: "account-1", verifiedEmail: "a@example.test", displayName: "A" }, via: "attendee", sessionId: "s" });
    await post(valid);
    expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({ attendeeAccountId: "account-1" }));
  });

  it("leaves an anyone-with-the-link response unlinked even for a signed-in visitor", async () => {
    mocks.getAttendee.mockResolvedValue({ account: { id: "account-1", verifiedEmail: "a@example.test", displayName: "A" }, via: "attendee", sessionId: "s" });
    await post(valid);
    expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({ attendeeAccountId: null }));
  });

  it("keys event and general forms apart for rate limits", async () => {
    await post({ ...valid, eventSlug: "sample-camporee" });
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(Request), "event:sample-camporee/camp-survey", "submit");
  });

  it("charges the client first, and requires a numeric Content-Length under the cap", async () => {
    const text = JSON.stringify(valid);
    const missing = await POST(new Request(url, { method: "POST", body: text }));
    expect(missing.status).toBe(411);
    const bad = await POST(new Request(url, { method: "POST", body: text, headers: { "Content-Length": "12abc" } }));
    expect(bad.status).toBe(411);
    const big = await POST(new Request(url, { method: "POST", body: text, headers: { "Content-Length": "999999" } }));
    expect(big.status).toBe(413);
    expect(mocks.clientLimit).toHaveBeenCalledTimes(3);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    mocks.clientLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await post(valid)).status).toBe(429);
  });

  it("stops reading a chunked body that passes the cap even when it states a small length", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(50_000)); if (pulls > 100) controller.close(); } });
    const response = await POST(new Request(url, { method: "POST", body: stream, headers: { "Content-Length": "100" }, duplex: "half" } as RequestInit));
    expect(response.status).toBe(413);
    expect(pulls).toBeLessThan(20);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("requires sign-in for a signed-in form, and treats a pending second step as signed out", async () => {
    mocks.findForm.mockResolvedValue(row({ fillAccess: "SIGNED_IN" }));
    const response = await post(valid);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("SIGN_IN_REQUIRED");
    mocks.getAttendee.mockResolvedValue({ account: { id: "account-1", verifiedEmail: "a@example.test", displayName: "A" }, via: "attendee", sessionId: "s" });
    mocks.secondStep.mockResolvedValue(true);
    expect((await post(valid)).status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("is rate limited, and 404s an unknown form or a hidden event", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await post(valid)).status).toBe(429);
    mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
    mocks.findForm.mockResolvedValue(null);
    expect((await post(valid)).status).toBe(404);
    mocks.getLanding.mockResolvedValue(null);
    expect((await post({ ...valid, eventSlug: "draft-event" })).status).toBe(404);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ slug: "Bad Slug", idempotencyKey: "key-12345678", answers: {} })).status).toBe(400);
    expect((await post({ ...valid, idempotencyKey: "short" })).status).toBe(400);
  });

  it("asks the idempotent store even for a closed form, so a late retry still succeeds", async () => {
    mocks.findForm.mockResolvedValue(row({ status: "CLOSED" }));
    expect((await post(valid)).status).toBe(201);
    mocks.store.mockRejectedValue(new InformationFormError("FORM_NOT_OPEN", "This form is not taking answers right now."));
    expect((await post({ ...valid, idempotencyKey: "another-key-1" })).status).toBe(409);
  });

  it("never echoes or logs answers in an error", async () => {
    mocks.store.mockRejectedValue(new Error("boom"));
    const response = await post(valid);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("synthetic answer");
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("synthetic answer");
    mocks.store.mockRejectedValue(new InformationFormError("ANSWERS_INVALID", "Comments is too long.", [{ key: "comments", message: "Comments is too long." }]));
    const invalid = await post(valid);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "ANSWERS_INVALID", message: "Comments is too long.", issues: [{ key: "comments", message: "Comments is too long." }] });
  });
});
