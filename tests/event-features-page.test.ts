import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/more/features` (#965): the page renders every feature with its state, a switch
 * only for the viewers who may change it, a Settings link only to pages they may
 * open, and the creation form carries the features step. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/more/features", notFound: () => { throw new Error("not found"); } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));
const mocks = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  resolveClubOversight: vi.fn(),
  resolveStaffViewer: vi.fn(),
  moduleState: vi.fn(),
  getEventSettings: vi.fn(),
  loadEventFeatureFacts: vi.fn(),
  getGeneralLinkSettings: vi.fn(),
  getTeamSettings: vi.fn(),
}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/club-rosters/event-oversight", () => ({ resolveClubOversight: mocks.resolveClubOversight }));
vi.mock("@/modules/club-forms/access", () => ({ resolveStaffViewer: mocks.resolveStaffViewer }));
vi.mock("@/modules/event-modules/service", () => ({ moduleState: mocks.moduleState }));
vi.mock("@/modules/events/repository", () => ({ getEventSettings: mocks.getEventSettings }));
vi.mock("@/modules/event-features/repository", () => ({ loadEventFeatureFacts: mocks.loadEventFeatureFacts }));
vi.mock("@/modules/general-link-registrations/repository", () => ({ getGeneralLinkSettings: mocks.getGeneralLinkSettings }));
vi.mock("@/modules/club-teams/settings-repository", () => ({ getTeamSettings: mocks.getTeamSettings }));

import EventFeaturesPage from "@/app/(workspace)/more/features/page";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { eventPermissions, type EventPermission } from "@/modules/access/permissions";
import type { EventModuleKey } from "@/modules/event-modules/catalog";

const event = { id: "event_1", name: "Synthetic Camporee", slug: "synthetic-camporee" };

function settingsRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "event_1", name: "Synthetic Camporee", slug: "synthetic-camporee", startsOn: "2027-05-01", endsOn: "2027-05-03", timezone: "America/Chicago",
    location: "Camp Example", capacity: null, publicInfoUrl: null, supportContact: "help@imsda-events.test", tagline: null, subtitle: null, helpEmail: null,
    hubTitle: null, hubIntro: null, refundPolicy: null, hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null,
    hotelInstructions: null, approvedPaymentInstructions: null, isPublished: true, archivedAt: null, registrationOpensOn: null, registrationClosesOn: null,
    waitlistEnabled: true, collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false, attendeeEditPolicy: "VERIFY_EVERY_EDIT",
    billingMode: "ATTENDEE_PAY", audience: "GENERAL", seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: false,
    publishedFormCount: 1, publishedForms: [], warnings: [], readiness: { ready: true, items: [], optionalItems: [], completedCount: 0 },
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function signIn(input: {
  globalRole: "SYSTEM_ADMIN" | null;
  permissions: readonly EventPermission[];
  stored?: readonly EventModuleKey[];
  forced?: readonly EventModuleKey[];
  club?: boolean;
}) {
  mocks.resolveEventContext.mockResolvedValue({
    event,
    permissions: input.permissions,
    user: { id: "user-1", displayName: "Riley Staff", email: "riley@imsda-events.test", globalRole: input.globalRole },
  });
  mocks.resolveClubOversight.mockResolvedValue({ allowed: Boolean(input.club), clubEvent: Boolean(input.club) });
  mocks.resolveStaffViewer.mockResolvedValue(input.globalRole === "SYSTEM_ADMIN" ? { kind: "STAFF" } : null);
  const stored = new Set<EventModuleKey>(["public-content", ...(input.stored ?? [])]);
  const forced = new Set<EventModuleKey>(input.forced ?? []);
  mocks.moduleState.mockResolvedValue({ stored, effective: new Set([...stored, ...forced]), dataPresent: forced, dataForced: forced });
  mocks.getEventSettings.mockResolvedValue(settingsRecord({ audience: input.club ? "CLUB" : "GENERAL" }));
  mocks.loadEventFeatureFacts.mockResolvedValue({ showOnCalendar: true, lodgingSetUp: true, mealsSetUp: false });
  mocks.getGeneralLinkSettings.mockResolvedValue(input.club ? { enabled: false, eligible: true, problem: null } : null);
  mocks.getTeamSettings.mockResolvedValue(null);
}

async function render() {
  return renderToStaticMarkup(await EventFeaturesPage({ searchParams: Promise.resolve({ event: event.id }) }));
}

const rowOf = (markup: string, id: string) => {
  const start = markup.indexOf(`data-feature="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</tr>", start));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/more/features", () => {
  it("is titled Event features and lists every feature in one table", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions });
    const markup = await render();
    // The topbar's h1 names the page; the body draws no second heading, only the shared header (#981).
    expect(markup).not.toContain("duplicate-page-title");
    expect(markup).not.toMatch(/<h[12][^>]*>Event features<\/h[12]>/);
    expect(markup).toContain('class="staff-page-header"');
    // This page is where features are turned on or off: its one sentence says so.
    expect(markup).toContain("Turn features on or off for Synthetic Camporee.");
    expect(markup).toContain('class="report-table table-cards event-features-table"');
    for (const id of [
      "module:honors", "module:event-patches", "module:club-assignments", "module:seminar-assignments", "module:merchandise", "module:attendee-community", "module:public-content",
      "column:waitlistEnabled", "column:autoPromoteWaitlist", "column:collectsShirtSizes", "column:hostedPaymentLinkEnabled", "column:checksAdultBackgrounds",
      "general-link", "teams", "publish", "calendar", "lodging", "meals",
    ]) expect(markup).toContain(`data-feature="${id}"`);
    // Labelled cells for the phone cards.
    expect(markup).toContain('data-label="State"');
    expect(markup).toContain('data-label="Switch"');
    // The Event modules page stays reachable, through the page's one cross-link.
    expect(markup).toContain('href="/more?event=event_1"');
    expect(markup.split('href="/more?event=event_1"').length - 1).toBe(1);
    expect(markup).toContain("Module requests and recent activity");
  });

  it("gives a system administrator a switch on modules, event columns, publish and the calendar", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, stored: ["merchandise"] });
    const markup = await render();
    for (const id of ["module:merchandise", "module:attendee-community", "column:waitlistEnabled", "column:collectsShirtSizes", "publish", "calendar"]) {
      expect(rowOf(markup, id), id).toContain('role="switch"');
    }
    expect(rowOf(markup, "module:merchandise")).toContain('aria-checked="true"');
    expect(rowOf(markup, "module:attendee-community")).toContain('aria-checked="false"');
    // Public content, lodging and meals have no switch.
    for (const id of ["module:public-content", "lodging", "meals"]) expect(rowOf(markup, id), id).not.toContain('role="switch"');
    expect(rowOf(markup, "lodging")).toContain("Set up");
    expect(rowOf(markup, "meals")).toContain("Not set up");
    expect(rowOf(markup, "meals")).toContain('href="/more/meals?event=event_1"');
  });

  it("gives an Event Admin the event columns and publish, and modules and the calendar read only", async () => {
    signIn({ globalRole: null, permissions: eventPermissions, stored: ["merchandise"] });
    const markup = await render();
    for (const id of ["column:waitlistEnabled", "column:checksAdultBackgrounds", "publish"]) expect(rowOf(markup, id), id).toContain('role="switch"');
    for (const id of ["module:merchandise", "module:attendee-community", "calendar"]) {
      expect(rowOf(markup, id), id).not.toContain('role="switch"');
      expect(rowOf(markup, id), id).toContain("Read only");
    }
    expect(rowOf(markup, "module:attendee-community")).toContain("A system administrator turns this on or off.");
    expect(rowOf(markup, "module:attendee-community")).toContain("Request this");
    expect(markup).toContain("A system administrator turns modules and the public calendar on or off.");
  });

  it("shows staff without event settings access the state of every feature and no switch at all", async () => {
    signIn({ globalRole: null, permissions: ["VIEW_EVENT", "VIEW_REPORTS"], stored: ["merchandise"] });
    const markup = await render();
    expect(markup).not.toContain('role="switch"');
    expect(markup).toContain("You can see each feature&#x27;s state but not change it.");
    expect(rowOf(markup, "column:waitlistEnabled")).toContain("On");
    expect(rowOf(markup, "column:waitlistEnabled")).toContain("Read only");
    expect(rowOf(markup, "publish")).toContain("Published");
    expect(rowOf(markup, "column:waitlistEnabled")).not.toContain("<a ");
    expect(rowOf(markup, "module:attendee-community")).not.toContain("Request this");
  });

  it("shows merchandise that has products as on and refused, with the reason", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, forced: ["merchandise"] });
    const row = rowOf(await render(), "module:merchandise");
    expect(row).toContain("On because this event has products.");
    expect(row).not.toContain('role="switch"');
  });

  it("shows the general link and teams as switches on a club event, and as club only on a general one", async () => {
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions, club: true, stored: ["honors"] });
    const club = await render();
    expect(rowOf(club, "general-link")).toContain('role="switch"');
    expect(rowOf(club, "teams")).toContain('role="switch"');
    expect(rowOf(club, "general-link")).toContain("#general-link");
    expect(rowOf(club, "module:honors")).toContain('aria-checked="true"');
    signIn({ globalRole: "SYSTEM_ADMIN", permissions: eventPermissions });
    const general = await render();
    expect(rowOf(general, "general-link")).toContain("Club events only");
    expect(rowOf(general, "teams")).not.toContain('role="switch"');
    expect(rowOf(general, "module:honors")).toContain("Does not apply to this event");
  });

  it("links Settings only to pages the viewer may open", async () => {
    signIn({ globalRole: null, permissions: ["VIEW_EVENT", "MANAGE_FINANCE"], stored: ["merchandise"] });
    const markup = await render();
    // Meals opens for finance staff; lodging and merchandise need event settings access.
    expect(rowOf(markup, "meals")).toContain('href="/more/meals?event=event_1"');
    expect(rowOf(markup, "lodging")).not.toContain("<a ");
    expect(rowOf(markup, "module:merchandise")).not.toContain("<a ");
  });
});

describe("the creation form (#965)", () => {
  const html = (mode: "create" | "edit") => renderToStaticMarkup(createElement(EventSettingsWorkspace, {
    mode,
    initialEvent: mode === "edit" ? settingsRecord() as never : null,
  }));

  it("carries the features step after the basics, collapsed, only when creating", () => {
    const create = html("create");
    expect(create).toContain("Which features does this event use?");
    expect(create).toContain("data-creation-features");
    expect(create.indexOf("Which features does this event use?")).toBeGreaterThan(create.indexOf("Step 1"));
    expect(create.indexOf("Which features does this event use?")).toBeLessThan(create.indexOf("Step 2"));
    expect(html("edit")).not.toContain("Which features does this event use?");
  });

  it("is linked from the setup page's three flows", () => {
    const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(read("components/event-settings-workspace.tsx")).toContain("CreationFeaturesStep");
    expect(read("components/start-from-template.tsx")).toContain("CreationFeaturesStep");
    expect(read("components/copy-from-past-event.tsx")).toContain("CreationFeaturesStep");
  });
});
