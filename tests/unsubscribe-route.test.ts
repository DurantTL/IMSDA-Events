import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  return {
    recordAnnouncementOptOut: vi.fn(),
    resolveUnsubscribeToken: vi.fn(),
    removeAnnouncementOptOuts: vi.fn(),
    findActiveMembership: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    setAnnouncementEssential: vi.fn(),
  };
});

vi.mock("@/modules/communications/email-preferences-repository", () => ({
  recordAnnouncementOptOut: mocks.recordAnnouncementOptOut,
  removeAnnouncementOptOuts: mocks.removeAnnouncementOptOuts,
  resolveUnsubscribeToken: mocks.resolveUnsubscribeToken,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/communications/announcement-essential", () => ({ setAnnouncementEssential: mocks.setAnnouncementEssential }));

import { GET, POST } from "@/app/api/public/unsubscribe/[token]/route";
import { PATCH } from "@/app/api/events/[eventId]/announcements/[announcementId]/essential/route";
import { deriveUnsubscribeToken } from "@/modules/communications/email-preferences";

// An opaque token: it holds no address; the lookup (mocked here, real in the database script) says who it is for.
const token = deriveUnsubscribeToken({ email: "avery@example.test", eventId: "event-1" });
const context = (value = token) => ({ params: Promise.resolve({ token: value }) });

function post(body: string, value = token, headers: Record<string, string> = {}) {
  return POST(
    new Request(`https://events.imsda.test/api/public/unsubscribe/${value}`, {
      method: "POST",
      // No Origin, no cookie, no CSRF token: a mail client's one-click POST carries none.
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body,
    }),
    context(value),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveUnsubscribeToken.mockImplementation(async (value: string) => (
    value === token ? { email: "avery@example.test", eventId: "event-1" } : null
  ));
  mocks.recordAnnouncementOptOut.mockResolvedValue({ recorded: true, id: "optout-1" });
  mocks.removeAnnouncementOptOuts.mockResolvedValue({ removedCount: 1 });
});

describe("public unsubscribe endpoint (#838)", () => {
  it("accepts the RFC 8058 one-click POST with no login or CSRF token, for the signed address only", async () => {
    const response = await post("List-Unsubscribe=One-Click");
    expect(response.status).toBe(200);
    expect(mocks.recordAnnouncementOptOut).toHaveBeenCalledWith({
      email: "avery@example.test",
      eventId: "event-1",
      scope: "EVENT",
      source: "ONE_CLICK",
    });
    expect(mocks.rejectCrossOriginRequest).not.toHaveBeenCalled();
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("accepts the one-click POST as multipart/form-data too, as RFC 8058 allows", async () => {
    const form = new FormData();
    form.set("List-Unsubscribe", "One-Click");
    const response = await POST(
      new Request(`https://events.imsda.test/api/public/unsubscribe/${token}`, { method: "POST", body: form }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(mocks.recordAnnouncementOptOut).toHaveBeenCalledWith(expect.objectContaining({ email: "avery@example.test", scope: "EVENT", source: "ONE_CLICK" }));
  });

  it("refuses an unknown or malformed token without touching anything", async () => {
    for (const bad of [`${token.slice(0, 42)}x`, "garbage", "", "a".repeat(5000)]) {
      const response = await post("List-Unsubscribe=One-Click", bad);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
    expect(mocks.recordAnnouncementOptOut).not.toHaveBeenCalled();
    expect(mocks.removeAnnouncementOptOuts).not.toHaveBeenCalled();
  });

  it("answers a body that is not a form with 400, never an unhandled error", async () => {
    const response = await POST(
      new Request(`https://events.imsda.test/api/public/unsubscribe/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{\"a\":1}" }),
      context(),
    );
    expect(response.status).toBe(400);
    expect(mocks.recordAnnouncementOptOut).not.toHaveBeenCalled();
  });

  it("refuses a POST that is neither one-click nor a page choice", async () => {
    expect((await post("")).status).toBe(400);
    expect((await post("List-Unsubscribe=Something")).status).toBe(400);
    expect((await post("action=delete")).status).toBe(400);
    expect(mocks.recordAnnouncementOptOut).not.toHaveBeenCalled();
  });

  it("opts out of this event or of all announcements from the page, then returns to it", async () => {
    const event = await post("action=event");
    expect(event.status).toBe(303);
    expect(event.headers.get("location")).toBe(`/unsubscribe/${token}?done=event`);
    expect(mocks.recordAnnouncementOptOut).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "EVENT", source: "UNSUBSCRIBE_PAGE" }));

    const all = await post("action=all");
    expect(all.headers.get("location")).toBe(`/unsubscribe/${token}?done=all`);
    expect(mocks.recordAnnouncementOptOut).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "ALL", eventId: "event-1" }));
  });

  it("re-subscribes from the page", async () => {
    const response = await post("action=resubscribe");
    expect(response.headers.get("location")).toBe(`/unsubscribe/${token}?done=resubscribed`);
    expect(mocks.removeAnnouncementOptOuts).toHaveBeenCalledWith({ email: "avery@example.test", eventId: "event-1" });
  });

  it("never changes anything on a GET, which link scanners fetch; it sends a valid link to the page", async () => {
    const response = await GET(new Request(`https://events.imsda.test/api/public/unsubscribe/${token}`), context());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/unsubscribe/${token}`);
    expect(mocks.recordAnnouncementOptOut).not.toHaveBeenCalled();
  });

  it("answers a GET for an invalid token with 404, not a redirect, and does not throw", async () => {
    for (const bad of ["garbage", "", `${token.slice(0, 42)}x`]) {
      const response = await GET(new Request(`https://events.imsda.test/api/public/unsubscribe/${bad}`), context(bad));
      expect(response.status).toBe(404);
    }
  });
});

describe("marking an announcement essential (#838, #897)", () => {
  const params = { params: Promise.resolve({ eventId: "event-1", announcementId: "announcement-1" }) };
  const request = (body: unknown) => new Request("https://events.imsda.test/api/events/event-1/announcements/announcement-1/essential", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify(body),
  });
  // The real permission mapping runs; only the membership lookup is stubbed.
  const asRole = (role: string | null, permissions: string[] = []) => {
    mocks.findActiveMembership.mockResolvedValue(
      role ? { eventId: "event-1", userId: "staff-1", role, status: "ACTIVE", permissions } : null,
    );
  };

  beforeEach(() => {
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1", email: "staff@example.test", displayName: "Staff" } });
    mocks.setAnnouncementEssential.mockResolvedValue({ id: "announcement-1", isEssential: true, changed: true });
  });

  it.each(["COMMUNICATIONS_MANAGER", "EVENT_ADMIN"])("lets a %s mark and clear it, as the actor", async (role) => {
    asRole(role);
    const marked = await PATCH(request({ essential: true }), params);
    expect(marked.status).toBe(200);
    expect(mocks.setAnnouncementEssential).toHaveBeenCalledWith("event-1", "announcement-1", "staff-1", true);
    mocks.setAnnouncementEssential.mockResolvedValue({ id: "announcement-1", isEssential: false, changed: true });
    const cleared = await PATCH(request({ essential: false }), params);
    expect(cleared.status).toBe(200);
    expect(mocks.setAnnouncementEssential).toHaveBeenLastCalledWith("event-1", "announcement-1", "staff-1", false);
  });

  it("lets staff holding only a CONFIGURE_EVENT grant do it", async () => {
    asRole("READ_ONLY_STAFF", ["CONFIGURE_EVENT"]);
    expect((await PATCH(request({ essential: true }), params)).status).toBe(200);
    expect(mocks.setAnnouncementEssential).toHaveBeenCalledTimes(1);
  });

  it.each(["REGISTRATION_MANAGER", "FINANCE_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"])("refuses a %s with 403 and changes nothing", async (role) => {
    asRole(role);
    const response = await PATCH(request({ essential: true }), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "PERMISSION_DENIED", message: expect.stringMatching(/MANAGE_COMMUNICATIONS.*CONFIGURE_EVENT/) }));
    expect(mocks.setAnnouncementEssential).not.toHaveBeenCalled();
  });

  it("refuses someone not assigned to the event with EVENT_ACCESS_DENIED, and changes nothing", async () => {
    asRole(null);
    const response = await PATCH(request({ essential: true }), params);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("EVENT_ACCESS_DENIED");
    expect(mocks.setAnnouncementEssential).not.toHaveBeenCalled();
  });

  it("answers 401 with no session", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await PATCH(request({ essential: true }), params)).status).toBe(401);
    expect(mocks.setAnnouncementEssential).not.toHaveBeenCalled();
  });

  it("answers 500 on an unexpected error, with nothing changed", async () => {
    mocks.findActiveMembership.mockRejectedValue(new Error("database unavailable"));
    const response = await PATCH(request({ essential: true }), params);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("ANNOUNCEMENT_ESSENTIAL_REQUEST_FAILED");
    expect(mocks.setAnnouncementEssential).not.toHaveBeenCalled();
  });

  it("rejects a malformed body and an unknown announcement", async () => {
    asRole("COMMUNICATIONS_MANAGER");
    expect((await PATCH(request({ essential: "yes" }), params)).status).toBe(400);
    mocks.setAnnouncementEssential.mockResolvedValue(null);
    expect((await PATCH(request({ essential: true }), params)).status).toBe(404);
  });
});
