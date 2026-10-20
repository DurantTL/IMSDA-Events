import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  listNotificationSwitches: vi.fn(),
  setNotificationEnabled: vi.fn(),
  listEventStaffListSummaries: vi.fn(),
  getPlatformSettings: vi.fn(),
  listEventEmailStates: vi.fn(),
  getAdminAttentionSummary: vi.fn(),
  updatePlatformAddresses: vi.fn(),
  logError: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: <T>(handler: T) => handler }));
vi.mock("@/modules/notifications/settings", () => ({
  listNotificationSwitches: mocks.listNotificationSwitches,
  setNotificationEnabled: mocks.setNotificationEnabled,
}));
vi.mock("@/modules/notifications/event-lists", () => ({ listEventStaffListSummaries: mocks.listEventStaffListSummaries }));
vi.mock("@/modules/system-admin/platform-settings", async () => {
  const actual = await vi.importActual<typeof import("@/modules/system-admin/platform-settings")>("@/modules/system-admin/platform-settings");
  return { ...actual, getPlatformSettings: mocks.getPlatformSettings, updatePlatformAddresses: mocks.updatePlatformAddresses };
});

vi.mock("@/modules/communications/event-email-pause", () => ({ listEventEmailStates: mocks.listEventEmailStates }));
vi.mock("@/modules/communications/effective-delivery", () => ({ isPlatformEmailConfigured: () => true, isEmailEnvironmentConfigured: () => true }));
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: () => true }));
vi.mock("@/integrations/email/provider", () => ({ getEmailAvailability: () => ({ deliveryConfigured: true, webhookConfigured: true }) }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: mocks.getAdminAttentionSummary }));

import EmailPage from "@/app/(workspace)/admin/email/page";
import OldNotificationsPage from "@/app/(workspace)/admin/notifications/page";
import { GET, PATCH } from "@/app/api/admin/notifications/route";
import { NotificationsWorkspace } from "@/components/notifications-workspace";
import { notificationCatalog } from "@/modules/notifications/catalog";
import { systemNavActiveItem, systemNavGroups, systemSubpageTitle } from "@/components/system-navigation";

const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
const everyoneElse = [
  ["signed out", null],
  ["an event admin", { id: "user-2", globalRole: "STAFF" }],
  ["a club director", { id: "user-3", globalRole: "USER" }],
] as const;

const allOn = notificationCatalog.map((entry) => ({ key: entry.key, enabled: true, updatedAt: null, updatedByName: null }));
const addresses = {
  supportContact: "support@imsda-events.test",
  securityAlertEmail: null,
  newClubApplicationEmail: "clubs@imsda-events.test",
};

function patch(body: unknown) {
  return PATCH(new Request("https://events.imsda-events.test/api/admin/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockReset" in mock && mock !== mocks.redirect) mock.mockReset();
  mocks.redirect.mockClear();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.listNotificationSwitches.mockResolvedValue(allOn);
  mocks.listEventStaffListSummaries.mockResolvedValue([
    { eventId: "event-1", eventName: "Synthetic Camporee", addressCount: 2 },
    { eventId: "event-2", eventName: "Synthetic Retreat", addressCount: 0 },
  ]);
  mocks.getPlatformSettings.mockResolvedValue({ ...addresses, defaultSenderName: "IMSDA Events", defaultSenderEmail: "events@imsda-events.test", defaultReplyToEmail: null });
  mocks.listEventEmailStates.mockResolvedValue([]);
  mocks.getAdminAttentionSummary.mockResolvedValue({ generatedAt: "2026-10-20T00:00:00.000Z", partial: false, truncated: false, total: 0, groups: [] });
  mocks.setNotificationEnabled.mockResolvedValue({ changed: true });
  mocks.updatePlatformAddresses.mockImplementation(async (input) => input);
});

describe("notifications routes: system administrators only (#1016)", () => {
  it.each(everyoneElse)("refuses to list switches for %s", async (_label, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    const response = await GET(new Request("https://events.imsda-events.test/api/admin/notifications"));
    expect(response.status).toBe(403);
    expect(mocks.listNotificationSwitches).not.toHaveBeenCalled();
  });

  it.each(everyoneElse)("refuses to change a switch or an address for %s", async (_label, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    expect((await patch({ key: "NEW_CLUB_APPLICATION", enabled: false })).status).toBe(403);
    expect((await patch({ addresses: { securityAlertEmail: "attacker@imsda-events.test" } })).status).toBe(403);
    expect(mocks.setNotificationEnabled).not.toHaveBeenCalled();
    expect(mocks.updatePlatformAddresses).not.toHaveBeenCalled();
  });

  it("lists every alert and the three addresses for a system administrator", async () => {
    const response = await GET(new Request("https://events.imsda-events.test/api/admin/notifications"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.switches).toHaveLength(notificationCatalog.length);
    expect(body.addresses).toMatchObject(addresses);
  });

  it("turns a switch off for the signed-in administrator", async () => {
    const response = await patch({ key: "NEW_CLUB_APPLICATION", enabled: false });
    expect(response.status).toBe(200);
    expect(mocks.setNotificationEnabled).toHaveBeenCalledWith("NEW_CLUB_APPLICATION", false, "admin-1");
  });

  it("refuses turning the lockout alert off without the confirmation, and accepts it with one", async () => {
    const refused = await patch({ key: "SIGN_IN_LOCKOUT_OFFICE_COPY", enabled: false });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("CONFIRMATION_REQUIRED");
    expect(mocks.setNotificationEnabled).not.toHaveBeenCalled();

    // Turning it back on never needs a warning.
    expect((await patch({ key: "SIGN_IN_LOCKOUT_OFFICE_COPY", enabled: true })).status).toBe(200);

    const confirmed = await patch({ key: "SIGN_IN_LOCKOUT_OFFICE_COPY", enabled: false, confirmed: true });
    expect(confirmed.status).toBe(200);
    expect(mocks.setNotificationEnabled).toHaveBeenLastCalledWith("SIGN_IN_LOCKOUT_OFFICE_COPY", false, "admin-1");
  });

  it("rejects an unknown key, a malformed body and a bad address", async () => {
    expect((await patch({ key: "NOT_A_KEY", enabled: false })).status).toBe(400);
    expect((await patch({ key: "NEW_CLUB_APPLICATION", enabled: "no" })).status).toBe(400);
    expect((await patch({ addresses: { securityAlertEmail: "not-an-address" } })).status).toBe(400);
    expect((await patch({ addresses: { organizationName: "Hijack", supportContact: "", securityAlertEmail: "", newClubApplicationEmail: "" } })).status).toBe(400);
    // An omitted key must not silently clear a saved address.
    expect((await patch({ addresses: { securityAlertEmail: "security@imsda-events.test" } })).status).toBe(400);
    expect((await patch({ addresses: { supportContact: "", securityAlertEmail: "" } })).status).toBe(400);
    expect(mocks.setNotificationEnabled).not.toHaveBeenCalled();
    expect(mocks.updatePlatformAddresses).not.toHaveBeenCalled();
  });

  it("saves the three addresses for a system administrator", async () => {
    const response = await patch({ addresses: { securityAlertEmail: " Security@IMSDA-Events.test ", supportContact: "", newClubApplicationEmail: "" } });
    expect(response.status).toBe(200);
    expect(mocks.updatePlatformAddresses).toHaveBeenCalledWith(
      { securityAlertEmail: "security@imsda-events.test", supportContact: null, newClubApplicationEmail: null },
      "admin-1",
    );
  });

  it("refuses a cross-origin change", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await patch({ key: "NEW_CLUB_APPLICATION", enabled: false })).status).toBe(403);
    expect(mocks.setNotificationEnabled).not.toHaveBeenCalled();
  });
});

describe("email page, with the staff alerts (#1016, #1043)", () => {
  it("sends a signed-out visitor to sign in and anyone but a system administrator to no-access", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(EmailPage()).rejects.toThrow("REDIRECT:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-2", globalRole: "STAFF" } });
    await expect(EmailPage()).rejects.toThrow("REDIRECT:/no-access");
    expect(mocks.listNotificationSwitches).not.toHaveBeenCalled();
    expect(mocks.listEventEmailStates).not.toHaveBeenCalled();
  });

  it("renders the three sections for a system administrator, in order", async () => {
    const element = await EmailPage();
    const children = (element as { props: { children: Array<{ type: unknown; props: Record<string, unknown> }> } }).props.children
      .filter((child) => child && typeof child === "object" && "type" in child && typeof child.type === "function");
    expect(children.map((child) => (child.type as { name: string }).name)).toEqual(["StaffPageHeader", "EmailDeliverySection", "NotificationsWorkspace", "EmailHealthSection"]);
    expect(children[2]!.props).toMatchObject({ addresses, switches: allOn, embedded: true });
    expect(children[1]!.props).toMatchObject({ sender: { name: "IMSDA Events", email: "events@imsda-events.test", replyTo: "" }, platformConfigured: true });
  });

  it("keeps the old Notifications address working by sending it to Email", () => {
    expect(() => OldNotificationsPage()).toThrow("REDIRECT:/admin/email#staff-alerts");
  });

  it("shows every alert with its recipients and a switch that starts on", () => {
    const html = renderToStaticMarkup(createElement(NotificationsWorkspace, { switches: allOn, addresses, events: [
      { eventId: "event-1", eventName: "Synthetic Camporee", addressCount: 2 },
      { eventId: "event-2", eventName: "Synthetic Retreat", addressCount: 0 },
    ] }));
    for (const entry of notificationCatalog) {
      expect(html).toContain(entry.name.replace(/'/g, "&#x27;"));
      expect(html).toContain(`data-notification="${entry.key}"`);
    }
    expect((html.match(/role="switch"/g) ?? [])).toHaveLength(notificationCatalog.length);
    expect((html.match(/aria-checked="true"/g) ?? [])).toHaveLength(notificationCatalog.length);
    expect(html).not.toContain('aria-checked="false"');
    // The club form alert (#1017) is listed with its recipients set per form and a link to the club forms.
    expect(html).toContain("Club form submitted");
    expect(html).not.toContain("Not sent yet.");
    expect(html).toContain("Set on each club form.");
    expect(html).toContain('href="/admin/club-forms"');
    // One editor for the three addresses, here.
    expect(html).toContain('value="support@imsda-events.test"');
    expect(html).toContain('value="clubs@imsda-events.test"');
    expect(html).toContain("Security alert address");
    // Links: the delivery log and each event's Communications page.
    expect(html).toContain('href="/communications"');
    expect(html).toContain('href="/communications?event=event-1"');
    expect(html).toContain("2 staff addresses");
    expect(html).toContain("No staff addresses");
  });

  it("shows a switch that was turned off as off, and the warning dialog closed until asked for", () => {
    const switches = allOn.map((entry) => (entry.key === "SIGN_IN_LOCKOUT_OFFICE_COPY" ? { ...entry, enabled: false } : entry));
    const html = renderToStaticMarkup(createElement(NotificationsWorkspace, { switches, addresses, events: [] }));
    expect((html.match(/aria-checked="false"/g) ?? [])).toHaveLength(1);
    expect(html).toMatch(/data-notification="SIGN_IN_LOCKOUT_OFFICE_COPY" data-state="off"/);
    expect(html).not.toContain("You won&#x27;t be told when accounts are locked");
    expect(html).toContain("There are no active events.");
  });

  it("is in the System management navigation as Email, with its own title", () => {
    const labels = systemNavGroups.flatMap((group) => group.items.map((item) => item.href));
    expect(labels).toContain("/admin/email");
    expect(labels).not.toContain("/admin/notifications");
    expect(systemNavActiveItem("/admin/email")?.label).toBe("Email");
    expect(systemNavActiveItem("/admin/notifications")?.label).toBe("Email");
    expect(systemSubpageTitle("/admin/email")).toBe("Email");
  });
});
