import { describe, expect, it } from "vitest";
import { buildEventModulesView } from "@/components/event-modules-page-model";
import { buildEventSetupView, eventSetupCardKeys } from "@/components/event-setup-model";
import { buildMoreDirectoryCards } from "@/components/staff-navigation";
import { eventPermissions, rolePermissions, type EventPermission } from "@/modules/access/permissions";
import { MAX_GROUP_CARDS } from "@/modules/system-admin/admin-hubs-model";
import { eventModuleKeys, type EventModuleKey } from "@/modules/event-modules/catalog";

/** #1586: the Event setup page's card groups. Synthetic permissions and module state only. */

const eventQuery = "?event=event_1";
const allModules = new Set<EventModuleKey>(eventModuleKeys);
const onlyPublic = new Set<EventModuleKey>(["public-content"]);
const none = new Set<EventModuleKey>();

function build(input: { permissions?: readonly EventPermission[]; isSystemAdmin?: boolean; clubEvent?: boolean; modules?: ReadonlySet<EventModuleKey> }) {
  const permissions = input.permissions ?? eventPermissions;
  const clubEvent = Boolean(input.clubEvent);
  const modules = input.modules ?? allModules;
  const cards = buildMoreDirectoryCards({ permissions, clubOversight: clubEvent, clubEvent, isSystemAdmin: Boolean(input.isSystemAdmin), clubFormsAccess: Boolean(input.isSystemAdmin), eventQuery });
  const view = buildEventModulesView({ cards, stored: modules, effective: modules, dataPresent: none, dataForced: none, isSystemAdmin: Boolean(input.isSystemAdmin), audience: clubEvent ? "CLUB" : "GENERAL" });
  return buildEventSetupView({ eventName: "Synthetic Camporee", eventQuery, permissions, view });
}

const titles = (view: ReturnType<typeof build>) => view.groups.map((group) => group.title);
const hrefs = (view: ReturnType<typeof build>) => view.groups.flatMap((group) => group.cards.map((card) => card.href));

describe("Event setup groups (#1586)", () => {
  it("lists Basics, Registration, Program, Lodging and items, Sales, then People and clubs, for full access on a club event", () => {
    const view = build({ isSystemAdmin: true, clubEvent: true });
    expect(titles(view).slice(0, 5)).toEqual(["Basics", "Registration", "Program", "Lodging and items", "Sales"]);
    const byTitle = Object.fromEntries(view.groups.map((group) => [group.title, group.cards.map((card) => card.title)]));
    expect(byTitle["Basics"]).toEqual(["Event settings", "Event features", "Emergency plan", "Public content"]);
    expect(byTitle["Registration"]).toEqual(["Registration forms", "Attendee setup", "Tags", "Information forms"]);
    expect(byTitle["Program"]).toEqual(["Honors Weekend classes", "Seminar assignments", "Meals"]);
    expect(byTitle["Lodging and items"]).toEqual(["Lodging", "Lodging assignments", "Lodging requests", "Issued assets"]);
    expect(byTitle["Sales"]).toEqual(["Merchandise", "Promo codes"]);
    // Seven people-and-clubs cards are split in two so no group is over six.
    const people = view.groups.slice(5);
    expect(people.map((group) => group.title)).toEqual(["People and clubs", "People and clubs (more)"]);
    expect(people.flatMap((group) => group.cards.map((card) => card.title))).toEqual(["Staff", "Clubs and churches", "This event's clubs", "Club assignments", "Club forms", "Event health information", "Event patches"]);
  });

  it("keeps every card to one of the setup keys, so other tabs' pages never appear", () => {
    const view = build({ isSystemAdmin: true, clubEvent: true });
    for (const href of ["/people/attendees", "/imports", "/more/reports", "/more/health", "/community", "/finance"]) {
      expect(hrefs(view).some((link) => link.split("?")[0] === href), href).toBe(false);
    }
    expect(eventSetupCardKeys).not.toContain("attendee-list");
    expect(eventSetupCardKeys).not.toContain("imports");
  });

  it("puts ?event= on every link, including the club directory, which has no event of its own", () => {
    for (const link of hrefs(build({ isSystemAdmin: true, clubEvent: true }))) expect(link, link).toContain("event=event_1");
  });

  it("says the promo codes card lives in Money and links the Money page", () => {
    const promo = build({}).groups.flatMap((group) => group.cards).find((card) => card.title === "Promo codes");
    expect(promo?.description.endsWith("Lives in Money.")).toBe(true);
    expect(promo?.href).toBe("/more/promo-codes?event=event_1");
  });

  it("hides module-owned cards when the module is off, however much permission the viewer has", () => {
    const view = build({ isSystemAdmin: true, clubEvent: true, modules: onlyPublic });
    for (const title of ["Honors Weekend classes", "Seminar assignments", "Merchandise", "Emergency plan", "Club assignments", "Event patches"]) {
      expect(view.groups.flatMap((group) => group.cards.map((card) => card.title)), title).not.toContain(title);
    }
    expect(view.groups.flatMap((group) => group.cards.map((card) => card.title))).toContain("Public content");
  });

  it("shows only what a role may open: Event features and settings need CONFIGURE_EVENT, Promo codes needs MANAGE_FINANCE", () => {
    const finance = build({ permissions: rolePermissions.FINANCE_MANAGER });
    const titlesOf = (view: ReturnType<typeof build>) => view.groups.flatMap((group) => group.cards.map((card) => card.title));
    expect(titlesOf(finance)).toContain("Promo codes");
    expect(titlesOf(finance)).not.toContain("Event features");
    expect(titlesOf(finance)).not.toContain("Event settings");
    const readOnly = build({ permissions: rolePermissions.READ_ONLY_STAFF });
    expect(titlesOf(readOnly)).not.toContain("Promo codes");
    expect(titlesOf(readOnly)).not.toContain("Staff");
  });

  it("never leaves a lone card while another group has more, and never a group over six, for any role", () => {
    const scenarios = [
      ...Object.values(rolePermissions).flatMap((permissions) => [false, true].flatMap((clubEvent) => [allModules, onlyPublic].map((modules) => build({ permissions, clubEvent, modules })))),
      build({ isSystemAdmin: true, clubEvent: true }),
      build({ isSystemAdmin: true }),
    ];
    for (const view of scenarios) {
      const sizes = view.groups.map((group) => group.cards.length);
      if (view.groups.length > 1) expect(sizes.every((size) => size >= 2), JSON.stringify(titles(view))).toBe(true);
      expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(MAX_GROUP_CARDS);
    }
  });

  it("names both groups when a lone card joins its neighbour, so no card sits under a heading that does not fit", () => {
    // Only Meals is left of Program for an Event Admin with the club and seminar modules off.
    const view = build({ modules: onlyPublic });
    const meals = view.groups.find((group) => group.cards.some((card) => card.title === "Meals"));
    expect(meals?.title).toBe("Registration / Program");
  });

  it("opens with the plain intro line for the event", () => {
    expect(build({}).description).toBe("Everything you set for Synthetic Camporee, on one page. Each item opens its own page.");
  });
});
