import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #741 slice 2: `/more` is the Event modules page. Visibility rules per role,
 * the health strip, and that devices no longer live here. Synthetic data only.
 */
import { staffSubpageTitle } from "@/components/staff-navigation";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const mocks = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  resolveClubOversight: vi.fn(),
  resolveStaffViewer: vi.fn(),
  moduleState: vi.fn(),
  listRecentAuditActivity: vi.fn(),
  getOperationalHealth: vi.fn(),
  listModuleRequestsForEvent: vi.fn(),
}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/club-rosters/event-oversight", () => ({ resolveClubOversight: mocks.resolveClubOversight }));
vi.mock("@/modules/club-forms/access", () => ({ resolveStaffViewer: mocks.resolveStaffViewer }));
vi.mock("@/modules/event-modules/service", () => ({ moduleState: mocks.moduleState }));
vi.mock("@/modules/event-modules/requests", () => ({ listModuleRequestsForEvent: mocks.listModuleRequestsForEvent }));
vi.mock("@/modules/audit/audit-service", () => ({ listRecentAuditActivity: mocks.listRecentAuditActivity }));
vi.mock("@/modules/operations/repository", () => ({ getOperationalHealth: mocks.getOperationalHealth }));
vi.mock("@/components/event-activity-panel", () => ({ EventActivityPanel: () => createElement("div", { "data-panel": "activity" }) }));

import MorePage from "@/app/(workspace)/more/page";
import { buildEventModulesView, healthStripState } from "@/components/event-modules-page-model";
import { buildMoreDirectoryCards } from "@/components/staff-navigation";
import { eventPermissions, type EventPermission } from "@/modules/access/permissions";
import { eventModuleKeys, type EventModuleKey } from "@/modules/event-modules/catalog";

const event = { id: "event_1", name: "Synthetic Camporee", slug: "synthetic-camporee" };
const noIssues = { summary: { total: 0, urgent: 0, watch: 0 } };

function signIn(input: { globalRole: "SYSTEM_ADMIN" | null; permissions: readonly EventPermission[]; enabled: readonly EventModuleKey[]; dataNeeds?: readonly EventModuleKey[]; honorsData?: boolean; clubEvent?: boolean }) {
  mocks.resolveEventContext.mockResolvedValue({
    event,
    permissions: input.permissions,
    user: { id: "user-1", displayName: "Riley Staff", email: "riley@imsda-events.test", globalRole: input.globalRole },
  });
  mocks.resolveClubOversight.mockResolvedValue({ allowed: Boolean(input.clubEvent), clubEvent: Boolean(input.clubEvent) });
  mocks.resolveStaffViewer.mockResolvedValue(input.globalRole === "SYSTEM_ADMIN" ? { kind: "STAFF" } : null);
  const stored = new Set<EventModuleKey>(["public-content", ...input.enabled]);
  const dataForced = new Set<EventModuleKey>(input.dataNeeds ?? []);
  mocks.moduleState.mockResolvedValue({
    stored,
    effective: new Set<EventModuleKey>([...stored, ...dataForced]),
    dataPresent: new Set<EventModuleKey>([...dataForced, ...(input.honorsData ? ["honors" as const] : [])]),
    dataForced,
  });
}

async function render() {
  return renderToStaticMarkup(await MorePage({ searchParams: Promise.resolve({ event: event.id }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRecentAuditActivity.mockResolvedValue([]);
  mocks.getOperationalHealth.mockResolvedValue(noIssues);
  mocks.listModuleRequestsForEvent.mockResolvedValue([]);
});

const cardTitles = (markup: string) => [...markup.matchAll(/data-testid="hub-card"[^>]*>.*?<span class="[^"]*cardTitle[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);

describe("/more as the Event setup page (#1586)", () => {
  it("is titled Event setup, with the grouped cards and the event name in the intro", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: [] });
    const markup = await render();
    expect(markup).not.toContain("Customize this event");
    expect(markup).not.toContain("duplicate-page-title");
    expect(markup).toContain('data-testid="admin-hub-event-setup"');
    expect(markup).toContain("Everything you set for Synthetic Camporee, on one page. Each item opens its own page.");
    expect(markup).toContain('href="/more/features?event=event_1"');
    expect(markup).toContain("Event features");
    expect(staffSubpageTitle("/more")).toBe("Event setup");
    expect(staffSubpageTitle("/more/merchandise")).not.toBe("Event setup");
  });

  it("lists the setup cards in groups, each linking its own page with the event, and leaves out other tabs' pages", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: ["merchandise", "emergency-plans"] });
    const markup = await render();
    // Program has only Meals here (the Honors and Seminar modules are off), so it joins Registration; the heading says so.
    for (const group of ["Basics", "Registration / Program", "Lodging and items", "Sales / People"]) expect(markup).toContain(`>${group}</h2>`);
    for (const href of ["/more/event-settings", "/more/features", "/registration-builder", "/more/attendee-configuration", "/more/tags", "/information-forms", "/more/meals", "/more/lodging", "/more/lodging/assignments", "/more/lodging/requests", "/more/issued-assets", "/more/merchandise", "/more/promo-codes", "/staff", "/more/event-content", "/more/emergency-plan"]) {
      expect(markup, href).toContain(`href="${href}?event=event_1"`);
    }
    // Pages that belong to other tabs are not setup cards, and the old phone-only list is gone.
    for (const href of ["/people/attendees", "/imports", "/more/reports", "/more/health", "/community"]) {
      expect(markup, href).not.toContain(`data-testid="hub-card" href="${href}?event=event_1"`);
    }
    expect(markup).not.toContain('aria-label="All tools"');
    expect(markup).not.toContain("more-task-groups");
    expect(markup).toContain("Lives in Money.");
  });

  it("offers the Event features card only to staff who can configure the event, and says only a system administrator turns modules on or off", async () => {
    signIn({ globalRole: null, permissions: eventPermissions.filter((permission) => permission !== "CONFIGURE_EVENT"), enabled: [] });
    const markup = await render();
    expect(markup).not.toContain("/more/features");
    expect(markup).toContain("Only a system administrator turns modules on or off.");
  });

  it("no longer draws a switch on the cards: Event features holds each module's switch", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: ["merchandise"] });
    const markup = await render();
    expect(markup).not.toContain('aria-label="Turn off Merchandise"');
    expect(markup).not.toContain('data-module="merchandise"');
    expect(markup).toContain('href="/more/merchandise?event=event_1"');
    // What is off stays below the cards, with its Enable for a system administrator.
    expect(markup).toContain("Not used by this event");
    expect(markup).toContain('aria-label="Enable Attendee community"');
    expect(markup).not.toContain('aria-label="Enable Honors classes"');
    expect(markup).toMatch(/<details class="panel activity-disclosure event-modules-off"(?! open)/);
  });

  it("shows an event admin no disabled card, no Enable and no Turn off", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: ["merchandise"] });
    const markup = await render();
    expect(markup).toContain('href="/more/merchandise?event=event_1"');
    expect(markup).not.toContain("Not used by this event");
    expect(markup).not.toContain(">Enable<");
    expect(markup).not.toContain("Turn off");
    expect(markup).not.toContain('href="/more/honors');
    expect(markup).toContain("Only a system administrator turns modules on or off");
  });

  it("shows staff only the cards they may open", async () => {
    signIn({ globalRole: null, permissions: ["VIEW_EVENT", "MANAGE_FINANCE"], enabled: ["merchandise", "attendee-community"] });
    const markup = await render();
    expect(markup).not.toContain('href="/more/merchandise');
    expect(markup).not.toContain('href="/community');
    expect(markup).not.toContain('href="/more/event-settings');
    expect(markup).toContain('href="/more/promo-codes?event=event_1"');
    expect(markup).not.toContain("Not used by this event");
    expect(markup).not.toContain(">Enable<");
  });

  it("hides a club module's card when the event is not a club event, and shows it on a club event", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: ["event-patches", "club-assignments"], clubEvent: false });
    let markup = await render();
    expect(markup).not.toContain('href="/more/event-patches');
    expect(markup).not.toContain('href="/more/club-assignments');
    signIn({ globalRole: null, permissions: eventPermissions, enabled: ["event-patches", "club-assignments"], clubEvent: true });
    markup = await render();
    expect(markup).toContain('href="/more/event-patches?event=event_1"');
    expect(markup).toContain('href="/more/club-assignments?event=event_1"');
  });

  it("shows Merchandise and Seminar assignments from the event's data with no stored row", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: [], dataNeeds: ["merchandise", "seminar-assignments"] });
    const markup = await render();
    expect(markup).toContain('href="/more/merchandise?event=event_1"');
    expect(markup).toContain('href="/more/program-assignments?event=event_1"');
    expect(markup).not.toContain('aria-label="Enable Merchandise"');
  });

  it("shows Honors once on a general event that has honors data, with no left-over entry, and lets it be enabled when it is off", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: ["honors"], honorsData: true, clubEvent: false });
    let markup = await render();
    expect(markup.match(/href="\/more\/honors\?event=event_1"/g)).toHaveLength(1);
    expect(markup).not.toContain("Left over from a change of event type");
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: [], honorsData: true, clubEvent: false });
    markup = await render();
    expect(markup).toContain('aria-label="Enable Honors classes"');
  });

  it("offers a system admin no Enable for a club module on a general event, and lists a leftover row with Turn off", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: ["event-patches"], clubEvent: false });
    const markup = await render();
    expect(markup).not.toContain('aria-label="Enable Club assignments"');
    expect(markup).toContain("Does not apply to this event.");
    expect(markup).toContain("Left over from a change of event type");
    expect(markup).toContain('aria-label="Turn off Event patches"');
  });

  it("offers Enable for club modules on a club event", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: [], clubEvent: true });
    const markup = await render();
    expect(markup).toContain('aria-label="Enable Club assignments"');
    expect(markup).not.toContain("Left over from a change of event type");
  });

  it("no longer lists signed-in devices; they live on the Profile page", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: [] });
    const markup = await render();
    expect(markup).not.toContain("Your signed-in devices");
    expect(markup).not.toContain("Sign out 1 other device");
    expect(markup).not.toContain("Sign-in settings");
  });

  it("keeps club forms for conference staff and never links Payments (a phone tab, #890)", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, enabled: [], clubEvent: true });
    const markup = await render();
    expect(cardTitles(markup)).toContain("Club forms");
    expect(markup).not.toContain('href="/finance?event=event_1"');
  });
});

describe("Event setup with nothing to show (#1586)", () => {
  it("says so plainly when no card remains, and does not point at Event features", async () => {
    signIn({ globalRole: null, permissions: ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"], enabled: [] });
    const markup = await render();
    expect(markup).toContain("Nothing to set up here for your role. Ask your event administrator if you need access to setup pages.");
    expect(markup).not.toContain("Event features shows what this event uses");
  });
});

describe("health strip", () => {
  it("reads all clear from the existing operational health summary", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: [] });
    const markup = await render();
    expect(markup).toContain('data-state="clear"');
    expect(markup).toContain("All clear");
    expect(markup).toContain('href="/more/health?event=event_1"');
  });

  it("flags attention with the counts when something is open", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, enabled: [] });
    mocks.getOperationalHealth.mockResolvedValue({ summary: { total: 3, urgent: 1, watch: 2 } });
    const markup = await render();
    expect(markup).toContain('data-state="attention"');
    expect(markup).toContain("3 items need attention (1 need action, 2 to watch).");
  });

  it("is left out, and reads no health data, for staff who cannot open Operational health", async () => {
    signIn({ globalRole: null, permissions: ["MANAGE_CHECK_IN"], enabled: [] });
    const markup = await render();
    expect(markup).not.toContain("event-modules-health");
    expect(mocks.getOperationalHealth).not.toHaveBeenCalled();
  });

  it("derives its message from the summary alone", () => {
    expect(healthStripState({ total: 0, urgent: 0, watch: 0 }).state).toBe("clear");
    expect(healthStripState({ total: 1, urgent: 0, watch: 1 }).message).toBe("1 item needs attention (1 to watch).");
  });
});

describe("page view rules", () => {
  const cards = buildMoreDirectoryCards({
    permissions: eventPermissions,
    clubOversight: false,
    clubEvent: false,
    isSystemAdmin: false,
    clubFormsAccess: false,
    eventQuery: "?event=event_1",
  });
  const only = new Set<EventModuleKey>(["public-content"]);
  const none = new Set<EventModuleKey>();

  it("lists the emergency plan as enabled when it is effective, and as disabled when it is not (#114)", () => {
    const on = new Set<EventModuleKey>(["public-content", "emergency-plans"]);
    const view = buildEventModulesView({ cards, stored: on, effective: on, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    expect(view.enabled.map((entry) => entry.definition.key)).toContain("emergency-plans");
    expect(view.enabled.find((entry) => entry.definition.key === "emergency-plans")?.card.href).toBe("/more/emergency-plan?event=event_1");
    expect(view.disabled.map((entry) => entry.definition.key)).not.toContain("emergency-plans");
    const off = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    expect(off.enabled.map((entry) => entry.definition.key)).not.toContain("emergency-plans");
  });

  it("gives only a system administrator the disabled modules and the right to toggle", () => {
    const admin = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    const other = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: none, dataForced: none, isSystemAdmin: false, audience: "GENERAL" });
    expect(admin.canToggle).toBe(true);
    expect(admin.disabled.map((entry) => entry.definition.key)).toEqual(eventModuleKeys.filter((key) => key !== "public-content"));
    expect(other.canToggle).toBe(false);
    expect(other.disabled).toEqual([]);
    expect(other.leftOver).toEqual([]);
  });

  it("marks club modules as not enableable on a general event, and enableable on a club event", () => {
    const general = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    const club = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "CLUB" });
    const canEnable = (view: typeof general, key: string) => view.disabled.find((entry) => entry.definition.key === key)?.canEnable;
    expect(canEnable(general, "club-assignments")).toBe(false);
    expect(canEnable(general, "event-patches")).toBe(false);
    expect(canEnable(general, "merchandise")).toBe(true);
    expect(canEnable(club, "club-assignments")).toBe(true);
  });

  it("lists a stored club module on a general event as left over, only for a system admin", () => {
    const stored = new Set<EventModuleKey>(["public-content", "club-assignments"]);
    const admin = buildEventModulesView({ cards, stored, effective: stored, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    expect(admin.leftOver.map((definition) => definition.key)).toEqual(["club-assignments"]);
    expect(admin.disabled.map((entry) => entry.definition.key)).not.toContain("club-assignments");
    expect(buildEventModulesView({ cards, stored, effective: stored, dataPresent: none, dataForced: none, isSystemAdmin: false, audience: "GENERAL" }).leftOver).toEqual([]);
  });

  it("lists Honors once, enabled, never also as left over, when a general event has honors data", () => {
    const stored = new Set<EventModuleKey>(["public-content", "honors"]);
    const view = buildEventModulesView({ cards, stored, effective: stored, dataPresent: new Set<EventModuleKey>(["honors"]), dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    expect(view.enabled.filter((entry) => entry.definition.key === "honors")).toHaveLength(1);
    expect(view.enabled.find((entry) => entry.definition.key === "honors")?.canToggle).toBe(true);
    expect(view.leftOver).toEqual([]);
  });

  it("never lists a module as left over when it is also in the enabled list, even with no honors data", () => {
    const stored = new Set<EventModuleKey>(["public-content", "honors"]);
    const view = buildEventModulesView({ cards, stored, effective: stored, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    expect(view.enabled.map((entry) => entry.definition.key)).toContain("honors");
    expect(view.leftOver.map((definition) => definition.key)).not.toContain("honors");
  });

  it("allows enabling Honors on a general event only when it has honors data", () => {
    const withData = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: new Set<EventModuleKey>(["honors"]), dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    const without = buildEventModulesView({ cards, stored: only, effective: only, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    expect(withData.disabled.find((entry) => entry.definition.key === "honors")?.canEnable).toBe(true);
    expect(without.disabled.find((entry) => entry.definition.key === "honors")?.canEnable).toBe(false);
  });

  it("gives a data-forced module no switch, even with a stored row", () => {
    const stored = new Set<EventModuleKey>(["public-content", "merchandise"]);
    const view = buildEventModulesView({ cards, stored, effective: stored, dataPresent: new Set<EventModuleKey>(["merchandise"]), dataForced: new Set<EventModuleKey>(["merchandise"]), isSystemAdmin: true, audience: "GENERAL" });
    expect(view.enabled.find((entry) => entry.definition.key === "merchandise")).toMatchObject({ canToggle: false, dataReason: "On because this event has products." });
  });

  it("treats a data-driven module as on, with a reason and no switch", () => {
    const effective = new Set<EventModuleKey>(["public-content", "merchandise"]);
    const view = buildEventModulesView({ cards, stored: only, effective, dataPresent: none, dataForced: none, isSystemAdmin: true, audience: "GENERAL" });
    const merch = view.enabled.find((entry) => entry.definition.key === "merchandise");
    expect(merch).toMatchObject({ canToggle: false, dataReason: "On because this event has products." });
    expect(view.disabled.map((entry) => entry.definition.key)).not.toContain("merchandise");
  });

  it("keeps ordinary staff tools out of the module lists", () => {
    const all = new Set<EventModuleKey>(eventModuleKeys);
    const view = buildEventModulesView({ cards, stored: all, effective: all, dataPresent: none, dataForced: none, isSystemAdmin: false, audience: "GENERAL" });
    expect(view.tools.map((card) => card.key)).toContain("event-settings");
    expect(view.enabled.map((entry) => entry.card.key)).not.toContain("event-settings");
  });
});
