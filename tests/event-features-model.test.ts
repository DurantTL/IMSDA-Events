import { describe, expect, it } from "vitest";
import { buildFeatureRows, type FeatureRow, type FeatureRowsInput } from "@/modules/event-features/model";
import { featureRequest } from "@/modules/event-features/requests";
import { eventColumnBase } from "@/modules/events/settings-draft";
import type { EventSettingsRecord } from "@/modules/events/repository";
import type { EventModuleKey } from "@/modules/event-modules/catalog";
import { eventPermissions } from "@/modules/access/permissions";

/**
 * The Event features page rows (#965): every feature listed, who gets a switch,
 * and which existing request each switch sends. Synthetic data only.
 */
const flagsOff = {
  waitlistEnabled: false,
  autoPromoteWaitlist: false,
  collectsShirtSizes: false,
  hostedPaymentLinkEnabled: false,
  checksAdultBackgrounds: false,
  isPublished: false,
  showOnCalendar: true,
};

const allCards = ["honors", "event-patches", "club-assignments", "program-assignments", "merchandise", "community", "event-content", "lodging", "meals"]
  .map((key) => ({ key, allowed: true, href: `/more/${key}?event=event_1` }));

function input(overrides: Partial<FeatureRowsInput> & { stored?: EventModuleKey[]; forced?: EventModuleKey[] } = {}): FeatureRowsInput {
  const { stored = ["public-content"], forced = [], ...rest } = overrides;
  const storedSet = new Set<EventModuleKey>(stored);
  const forcedSet = new Set<EventModuleKey>(forced);
  return {
    audience: "GENERAL",
    eventQuery: "?event=event_1",
    isSystemAdmin: true,
    permissions: eventPermissions,
    flags: flagsOff,
    modules: { stored: storedSet, effective: new Set([...storedSet, ...forcedSet]), dataPresent: forcedSet, dataForced: forcedSet },
    cards: allCards,
    generalLink: null,
    teamsEnabled: false,
    lodgingSetUp: false,
    mealsSetUp: false,
    moduleRequestsEnabled: true,
    ...rest,
  };
}

const byId = (rows: FeatureRow[], id: string) => rows.find((row) => row.id === id)!;

describe("every feature is listed (#965)", () => {
  it("lists the catalog modules, the event columns, the club rows, publish, calendar, lodging and meals, in that order", () => {
    expect(buildFeatureRows(input()).map((row) => row.id)).toEqual([
      "module:honors", "module:event-patches", "module:club-assignments", "module:seminar-assignments", "module:merchandise", "module:attendee-community", "module:public-content",
      "column:waitlistEnabled", "column:autoPromoteWaitlist", "column:collectsShirtSizes", "column:hostedPaymentLinkEnabled", "column:checksAdultBackgrounds",
      "general-link", "teams", "publish", "calendar", "lodging", "meals",
    ]);
  });

  it("shows public content as always on with no switch, and lodging and meals as set up or not with no switch", () => {
    const rows = buildFeatureRows(input({ lodgingSetUp: true }));
    expect(byId(rows, "module:public-content")).toMatchObject({ state: "always-on", stateLabel: "Always on", control: null });
    expect(byId(rows, "lodging")).toMatchObject({ state: "set-up", stateLabel: "Set up", control: null, settings: { label: "Settings" } });
    expect(byId(rows, "meals")).toMatchObject({ state: "not-set-up", stateLabel: "Not set up", control: null, settings: { label: "Set up", href: "/more/meals?event=event_1" } });
  });

  it("gives every row with a switch an action and a stated state", () => {
    for (const row of buildFeatureRows(input({ audience: "CLUB", generalLink: { enabled: false, eligible: true, problem: null } }))) {
      if (row.control) expect(row.action, row.id).not.toBeNull();
      expect(row.stateLabel, row.id).not.toBe("");
    }
  });

  it("marks the club-only rows as club events only on a general event, with no switch", () => {
    const rows = buildFeatureRows(input());
    expect(byId(rows, "general-link")).toMatchObject({ state: "not-applicable", stateLabel: "Club events only", control: null });
    expect(byId(rows, "teams")).toMatchObject({ state: "not-applicable", control: null });
    expect(byId(rows, "module:honors")).toMatchObject({ state: "not-applicable", control: null });
    expect(byId(rows, "module:event-patches").state).toBe("not-applicable");
  });

  it("shows the general link and teams as switches on a club event", () => {
    const rows = buildFeatureRows(input({ audience: "CLUB", stored: ["public-content", "honors"], generalLink: { enabled: true, eligible: true, problem: null }, teamsEnabled: true }));
    expect(byId(rows, "general-link").control).toMatchObject({ on: true, canChange: true });
    expect(byId(rows, "teams").control).toMatchObject({ on: true, canChange: true });
    expect(byId(rows, "module:honors")).toMatchObject({ state: "on", stateLabel: "On" });
  });
});

describe("who may switch what stays as it is today (#965)", () => {
  it("lets a system administrator switch modules, event columns, publish and the calendar", () => {
    const rows = buildFeatureRows(input({ flags: { ...flagsOff, isPublished: true } }));
    for (const id of ["module:merchandise", "column:waitlistEnabled", "column:collectsShirtSizes", "column:hostedPaymentLinkEnabled", "column:checksAdultBackgrounds", "publish", "calendar"]) {
      expect(byId(rows, id).control?.canChange, id).toBe(true);
    }
  });

  it("gives an Event Admin the event columns and publish, but modules and the calendar read only", () => {
    const rows = buildFeatureRows(input({ isSystemAdmin: false, flags: { ...flagsOff, isPublished: true } }));
    for (const id of ["column:waitlistEnabled", "column:collectsShirtSizes", "column:hostedPaymentLinkEnabled", "column:checksAdultBackgrounds", "publish"]) {
      expect(byId(rows, id).control?.canChange, id).toBe(true);
    }
    expect(byId(rows, "module:merchandise").control).toMatchObject({ canChange: false, reason: "A system administrator turns this on or off." });
    expect(byId(rows, "calendar").control).toMatchObject({ canChange: false, reason: "A system administrator turns this on or off." });
  });

  it("offers an Event Admin a request link for a module that is off, and never a system administrator", () => {
    expect(byId(buildFeatureRows(input({ isSystemAdmin: false })), "module:merchandise").request).toEqual({ href: "/more?event=event_1#request-a-feature", label: "Request this" });
    expect(byId(buildFeatureRows(input({ isSystemAdmin: true })), "module:merchandise").request).toBeNull();
    expect(byId(buildFeatureRows(input({ isSystemAdmin: false, permissions: ["MANAGE_FINANCE"] })), "module:merchandise").request).toBeNull();
    expect(byId(buildFeatureRows(input({ isSystemAdmin: false, moduleRequestsEnabled: false })), "module:merchandise").request).toBeNull();
  });

  it("shows staff without event settings access the state of every row and no usable switch", () => {
    const rows = buildFeatureRows(input({
      isSystemAdmin: false,
      permissions: ["VIEW_EVENT", "VIEW_REPORTS"],
      audience: "CLUB",
      stored: ["public-content", "honors"],
      generalLink: { enabled: true, eligible: true, problem: null },
      flags: { ...flagsOff, waitlistEnabled: true, isPublished: true },
    }));
    for (const row of rows) {
      if (row.control) expect(row.control.canChange, row.id).toBe(false);
    }
    expect(byId(rows, "column:waitlistEnabled")).toMatchObject({ state: "on", control: { on: true, canChange: false } });
    expect(byId(rows, "publish").control?.reason).toBe("Event settings access is needed to change this.");
    // No Settings link to a page they may not open.
    expect(byId(rows, "column:waitlistEnabled").settings).toBeNull();
    expect(byId(rows, "general-link").settings).toBeNull();
  });

  it("offers the Settings link of a module only when it is on and the viewer may open its page", () => {
    const on = buildFeatureRows(input({ stored: ["public-content", "merchandise"] }));
    expect(byId(on, "module:merchandise").settings).toEqual({ href: "/more/merchandise?event=event_1", label: "Settings" });
    expect(byId(on, "module:attendee-community").settings).toBeNull();
    const noCard = buildFeatureRows(input({ stored: ["public-content", "merchandise"], cards: allCards.map((card) => ({ ...card, allowed: card.key !== "merchandise" })) }));
    expect(byId(noCard, "module:merchandise").settings).toBeNull();
  });
});

describe("data-forced and dependent switches (#965)", () => {
  it("refuses to turn off merchandise while the event has products, saying why", () => {
    const rows = buildFeatureRows(input({ stored: ["public-content"], forced: ["merchandise"] }));
    expect(byId(rows, "module:merchandise")).toMatchObject({ state: "on", control: { on: true, canChange: false, reason: "On because this event has products." } });
  });

  it("asks before turning a stored module off, and never before turning one on", () => {
    const rows = buildFeatureRows(input({ stored: ["public-content", "merchandise"] }));
    const merchandise = byId(rows, "module:merchandise").control!;
    expect(merchandise.canChange).toBe(true);
    expect(merchandise.confirmOff).toMatchObject({ title: "Turn off Merchandise?" });
    expect(merchandise.confirmOff?.body).toContain("never removes the data");
    expect(merchandise.confirmOn).toBeNull();
  });

  it("asks before turning every other feature off, and before publishing", () => {
    const rows = buildFeatureRows(input({ audience: "CLUB", generalLink: { enabled: true, eligible: true, problem: null }, flags: { ...flagsOff, isPublished: true, waitlistEnabled: true } }));
    for (const id of ["column:waitlistEnabled", "column:autoPromoteWaitlist", "column:collectsShirtSizes", "column:hostedPaymentLinkEnabled", "column:checksAdultBackgrounds", "general-link", "teams", "publish", "calendar"]) {
      expect(byId(rows, id).control?.confirmOff, id).not.toBeNull();
    }
    expect(byId(rows, "publish").control?.confirmOn).toMatchObject({ confirmLabel: "Publish event" });
  });

  it("allows automatic promotion only while the waitlist is on", () => {
    expect(byId(buildFeatureRows(input()), "column:autoPromoteWaitlist").control).toMatchObject({ canChange: false, reason: "Turn on the waitlist first." });
    expect(byId(buildFeatureRows(input({ flags: { ...flagsOff, waitlistEnabled: true } })), "column:autoPromoteWaitlist").control?.canChange).toBe(true);
  });

  it("allows the calendar switch only once the event is published", () => {
    expect(byId(buildFeatureRows(input()), "calendar").control).toMatchObject({ canChange: false, reason: "Publish the event first." });
    expect(byId(buildFeatureRows(input({ flags: { ...flagsOff, isPublished: true, showOnCalendar: false } })), "calendar")).toMatchObject({ stateLabel: "Hidden", control: { on: false, canChange: true } });
  });

  it("keeps the general link off, with the reason, on a club event that is not billed to the church", () => {
    const rows = buildFeatureRows(input({ audience: "CLUB", generalLink: { enabled: false, eligible: false, problem: "The general registration link is for club events billed to the church." } }));
    expect(byId(rows, "general-link").control).toMatchObject({ on: false, canChange: false, reason: "The general registration link is for club events billed to the church." });
    // Already on: it can always be turned off.
    const on = buildFeatureRows(input({ audience: "CLUB", generalLink: { enabled: true, eligible: false, problem: "x" } }));
    expect(byId(on, "general-link").control?.canChange).toBe(true);
  });

  it("can still turn off a club module left over after a change to a general audience", () => {
    const rows = buildFeatureRows(input({ stored: ["public-content", "event-patches"] }));
    expect(byId(rows, "module:event-patches")).toMatchObject({ state: "on", control: { on: true, canChange: true } });
  });
});

describe("each switch sends an existing request (#965)", () => {
  const settings = {
    id: "event_1", name: "Synthetic Camporee", slug: "synthetic-camporee", startsOn: "2027-05-01", endsOn: "2027-05-03", timezone: "America/Chicago",
    location: "", capacity: null, publicInfoUrl: null, supportContact: "help@imsda-events.test", tagline: null, subtitle: null, helpEmail: null, hubTitle: null, hubIntro: null,
    refundPolicy: null, hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
    approvedPaymentInstructions: "Pay at the door.", isPublished: false, archivedAt: null, registrationOpensOn: null, registrationClosesOn: null,
    waitlistEnabled: true, collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false, attendeeEditPolicy: "VERIFY_EVERY_EDIT",
    billingMode: "ATTENDEE_PAY", audience: "GENERAL", seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: true,
    publishedFormCount: 0, publishedForms: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  } as unknown as EventSettingsRecord;
  const context = { eventId: "event_1", columnBase: eventColumnBase(settings), teamSettings: null };

  it("sends modules to the module API: PUT to turn on, DELETE to turn off", () => {
    expect(featureRequest({ type: "module", moduleKey: "merchandise" }, true, context)).toEqual({ url: "/api/events/event_1/modules/merchandise", method: "PUT" });
    expect(featureRequest({ type: "module", moduleKey: "merchandise" }, false, context)).toEqual({ url: "/api/events/event_1/modules/merchandise", method: "DELETE" });
  });

  it("sends an event column through the settings update with the dates it was loaded with", () => {
    const request = featureRequest({ type: "event-column", field: "collectsShirtSizes" }, true, context);
    expect(request).toMatchObject({ url: "/api/events/event_1", method: "PATCH" });
    expect(request.body).toMatchObject({
      collectsShirtSizes: true,
      // Everything else is sent back as stored, so the save changes nothing but the one switch.
      name: "Synthetic Camporee", slug: "synthetic-camporee", waitlistEnabled: true, autoPromoteWaitlist: true,
      approvedPaymentInstructions: "Pay at the door.", location: null,
      // The stale-write guard (#445).
      expectedStartsOn: "2027-05-01", expectedEndsOn: "2027-05-03",
    });
  });

  it("turns automatic promotion off with the waitlist, as the settings form does", () => {
    const request = featureRequest({ type: "event-column", field: "waitlistEnabled" }, false, context);
    expect(request.body).toMatchObject({ waitlistEnabled: false, autoPromoteWaitlist: false });
  });

  it("never sends an event column change for a viewer with no settings access", () => {
    expect(() => featureRequest({ type: "event-column", field: "waitlistEnabled" }, false, { ...context, columnBase: null })).toThrow("Event settings access is needed");
  });

  it("sends the general link, teams, publish and calendar to the APIs that already own them", () => {
    expect(featureRequest({ type: "general-link" }, true, context)).toEqual({ url: "/api/events/event_1/general-link", method: "PUT", body: { enabled: true } });
    expect(featureRequest({ type: "publish" }, true, context)).toEqual({ url: "/api/events/event_1/publish", method: "POST" });
    expect(featureRequest({ type: "publish" }, false, context)).toEqual({ url: "/api/events/event_1/unpublish", method: "POST" });
    expect(featureRequest({ type: "calendar" }, false, context)).toEqual({ url: "/api/admin/calendar/events/event_1", method: "PATCH", body: { showOnCalendar: false } });
  });

  it("sends teams with every other team rule as it is stored", () => {
    const teamSettings = { allowMultipleTeams: true, minTeamMembers: 4, maxTeamMembers: 8, maxAlternates: 1, ageAsOf: "2027-01-01", maxMemberAge: 21, booksLine: "Synthetic book", levelInfo: [{ level: "CONFERENCE" as const, date: "2027-03-01", place: "Synthetic Hall" }] };
    expect(featureRequest({ type: "teams" }, false, { ...context, teamSettings })).toEqual({
      url: "/api/events/event_1/team-settings", method: "PUT", body: { ...teamSettings, allowMultipleTeams: false },
    });
    expect(featureRequest({ type: "teams" }, true, context).body).toMatchObject({ allowMultipleTeams: true, maxAlternates: 0, levelInfo: [] });
  });

  it("encodes the event and module in the URL", () => {
    expect(featureRequest({ type: "module", moduleKey: "honors" }, true, { ...context, eventId: "a/b" }).url).toBe("/api/events/a%2Fb/modules/honors");
  });
});
