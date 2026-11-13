import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  registrationFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    registration: { findFirst: mocks.registrationFindFirst },
    messageOutbox: { findMany: mocks.messageFindMany },
  }),
}));

import { GET } from "@/app/api/events/[eventId]/registrations/[registrationId]/communications/route";

const call = (eventId = "evt_1", registrationId = "reg_1") =>
  GET(new Request(`https://events.imsda.test/api/events/${eventId}/registrations/${registrationId}/communications`), {
    params: Promise.resolve({ eventId, registrationId }),
  });

const user = { id: "usr_1", email: "staff@example.test", displayName: "Staff Sample", globalRole: null };

function healthRow() {
  return {
    id: "msg_h", templateKey: "HEALTH_RECORD_LINK", recipientKind: "REGISTRANT", recipientEmail: "sam@example.test", recipientName: "Sam Rivera",
    senderNameSnapshot: "IMSDA Events", replyToEmailSnapshot: null, subjectSnapshot: "Allergy form for Sam", bodyTextSnapshot: "peanut allergy details",
    status: "SENT", providerDeliveryStatus: null, attemptCount: 1, retryOfMessageId: null, capturedAt: null,
    sentAt: new Date("2026-06-01T00:05:00.000Z"), deliveredAt: null, failedAt: null, lastError: null,
    createdAt: new Date("2026-06-01T00:05:00.000Z"), templateVersion: null, retries: [], scheduledEmailRecipient: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.findActiveMembership.mockResolvedValue({ eventId: "evt_1", userId: "usr_1", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] });
  mocks.registrationFindFirst.mockResolvedValue({ id: "reg_1" });
  mocks.messageFindMany.mockResolvedValue([healthRow()]);
});

describe("GET registration communications (#179)", () => {
  it("answers 401 when signed out", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call()).status).toBe(401);
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("answers 403 without VIEW_SENSITIVE_DATA", async () => {
    mocks.findActiveMembership.mockResolvedValue({ eventId: "evt_1", userId: "usr_1", role: "COMMUNICATIONS_MANAGER", status: "ACTIVE", permissions: [] });
    expect((await call()).status).toBe(403);
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("answers 404 when the registration belongs to another event", async () => {
    mocks.registrationFindFirst.mockResolvedValue(null);
    const response = await call("evt_1", "reg_other");
    expect(response.status).toBe(404);
    expect(mocks.registrationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "reg_other", eventId: "evt_1" } }));
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
  });

  it("masks a health message for staff without VIEW_HEALTH_INFORMATION, and sends no-store", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toMatch(/Allergy|peanut/);
    expect(JSON.parse(text).rows[0]).toMatchObject({ subject: "Health record message", bodyText: null, contentWithheld: true });
  });

  it("shows the health message to staff granted VIEW_HEALTH_INFORMATION", async () => {
    mocks.findActiveMembership.mockResolvedValue({ eventId: "evt_1", userId: "usr_1", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: ["VIEW_HEALTH_INFORMATION"] });
    const body = await (await call()).json();
    expect(body.rows[0]).toMatchObject({ subject: "Allergy form for Sam", bodyText: "peanut allergy details", contentWithheld: false });
  });

  it("shows it to a system administrator, who holds every permission", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { ...user, globalRole: "SYSTEM_ADMIN" } });
    mocks.findActiveMembership.mockResolvedValue(null);
    const body = await (await call()).json();
    expect(body.rows[0]).toMatchObject({ bodyText: "peanut allergy details" });
  });
});
