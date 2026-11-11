import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  requireClubsAdministration: vi.fn(),
  previewSterlingReminders: vi.fn(),
  sendSterlingReminders: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/access", () => ({ requireClubsAdministration: mocks.requireClubsAdministration }));
vi.mock("@/modules/background-checks/reminders", () => ({
  previewSterlingReminders: mocks.previewSterlingReminders,
  sendSterlingReminders: mocks.sendSterlingReminders,
}));

import { POST as previewPost } from "@/app/api/admin/background-checks/reminders/preview/route";
import { POST as sendPost } from "@/app/api/admin/background-checks/reminders/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { BackgroundCheckOperationError } from "@/modules/background-checks/errors";

const post = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const FINGERPRINT = "a".repeat(64);
const selection = { rosterMemberIds: ["m1"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireClubsAdministration.mockResolvedValue({ id: "staff-1" });
  mocks.previewSterlingReminders.mockResolvedValue({ fingerprint: FINGERPRINT, messages: [] });
  mocks.sendSterlingReminders.mockResolvedValue({ batchId: "b1", people: 1, directorEmails: 1, volunteerEmails: 0, noRecipient: 0 });
});

describe("Sterling reminder routes (#1844)", () => {
  it("refuse a user who is not a clubs administrator, before reading or sending anything", async () => {
    mocks.requireClubsAdministration.mockRejectedValue(new AccessDeniedError("Clubs Administrator or system administrator access is required.", 403, "PERMISSION_DENIED"));
    const preview = await previewPost(post("/api/admin/background-checks/reminders/preview", { selection }));
    const send = await sendPost(post("/api/admin/background-checks/reminders", { selection, fingerprint: FINGERPRINT }));
    expect(preview.status).toBe(403);
    expect(send.status).toBe(403);
    expect(mocks.previewSterlingReminders).not.toHaveBeenCalled();
    expect(mocks.sendSterlingReminders).not.toHaveBeenCalled();
  });

  it("refuse a signed-out request", async () => {
    mocks.requireClubsAdministration.mockRejectedValue(new AccessDeniedError("Sign in.", 401, "AUTHENTICATION_REQUIRED"));
    expect((await sendPost(post("/api/admin/background-checks/reminders", { selection, fingerprint: FINGERPRINT }))).status).toBe(401);
    expect(mocks.sendSterlingReminders).not.toHaveBeenCalled();
  });

  it("previews with the chosen people", async () => {
    const response = await previewPost(post("/api/admin/background-checks/reminders/preview", { selection }));
    expect(response.status).toBe(200);
    expect(mocks.previewSterlingReminders).toHaveBeenCalledWith(selection);
  });

  it("sends as the signed-in staff person with the preview's fingerprint", async () => {
    const response = await sendPost(post("/api/admin/background-checks/reminders", { selection: { filter: "expiring", all: true }, fingerprint: FINGERPRINT }));
    expect(response.status).toBe(200);
    expect(mocks.sendSterlingReminders).toHaveBeenCalledWith({ filter: "expiring", all: true }, { fingerprint: FINGERPRINT, confirmRecent: false, actorUserId: "staff-1" });
  });

  it("will not send without a fingerprint, an unknown filter, or more than 500 people", async () => {
    expect((await sendPost(post("/api/admin/background-checks/reminders", { selection }))).status).toBe(400);
    expect((await sendPost(post("/api/admin/background-checks/reminders", { selection: { filter: "everyone", all: true }, fingerprint: FINGERPRINT }))).status).toBe(400);
    expect((await sendPost(post("/api/admin/background-checks/reminders", { selection: { rosterMemberIds: Array.from({ length: 501 }, (_, i) => `m${i}`) }, fingerprint: FINGERPRINT }))).status).toBe(400);
    expect(mocks.sendSterlingReminders).not.toHaveBeenCalled();
  });

  it("answers a changed preview and a recent reminder with 409, and passes the recent people along", async () => {
    mocks.sendSterlingReminders.mockRejectedValueOnce(new BackgroundCheckOperationError("PREVIEW_CHANGED", "Changed."));
    const changed = await sendPost(post("/api/admin/background-checks/reminders", { selection, fingerprint: FINGERPRINT }));
    expect(changed.status).toBe(409);
    expect((await changed.json()).error).toBe("PREVIEW_CHANGED");
    mocks.sendSterlingReminders.mockRejectedValueOnce(new BackgroundCheckOperationError("RECENTLY_REMINDED", "Recently.", { recentlyReminded: [{ rosterMemberId: "m1", name: "Avery Testperson", clubName: "Maple Pathfinders", remindedAt: "2026-11-08T12:00:00.000Z" }] }));
    const recent = await sendPost(post("/api/admin/background-checks/reminders", { selection, fingerprint: FINGERPRINT }));
    expect(recent.status).toBe(409);
    expect((await recent.json()).details.recentlyReminded[0].name).toBe("Avery Testperson");
  });

  it("has no GET that could send", async () => {
    const sendModule = await import("@/app/api/admin/background-checks/reminders/route");
    const previewModule = await import("@/app/api/admin/background-checks/reminders/preview/route");
    expect("GET" in sendModule).toBe(false);
    expect("GET" in previewModule).toBe(false);
  });
});
