import {
  buildSearchDestinations,
  type DestinationScope,
  type DestinationSearchContext,
  type SearchDestination,
} from "@/components/destination-search-model";
import { launcherFooterLinks } from "@/components/more-launcher-model";
import {
  buildMoreDirectoryCards,
  eventFeaturesItem,
  navigation,
} from "@/components/staff-navigation";
import { systemNavGroups, type SystemNavGroup } from "@/components/system-navigation";
import { eventPermissions } from "@/modules/access/permissions";

/**
 * The old to new route mapping (#1180): a committed, literal table of the staff
 * routes as they were before the navigation change, each with the place it has
 * now. It is deliberately NOT generated from the registries, so removing a route
 * from a registry (or from the menus) cannot quietly remove it from the check.
 * The tests assert that every `menu` row is still in the live registries and
 * reachable for a viewer who may open it, that every `reached` row is still
 * linked from its parent page's source, and that every `page.tsx` under
 * `app/(workspace)` is either in this table or on an explicit exclusion list.
 * A row grants nothing: every page keeps its own server-side authorization.
 */
export type RouteMappingKind =
  /** A destination in the menus and search (registry route). */
  | "menu"
  /** Another address for a menu destination (a redirect or a page that lights it). */
  | "alias"
  /** A sub-page reached from a parent page, not a menu entry. */
  | "reached"
  /** The System home, reached from the shell's System administration link. */
  | "shell"
  /** A real page with no menu entry today (kept as it was, not added to the navigation). */
  | "direct";

export type RouteMappingRow = {
  /** The staff route (no query string). */
  route: string;
  kind: RouteMappingKind;
  /** Where staff found it before. */
  oldPlace: "Event sidebar" | "More directory" | "System management" | "Account" | "Page link";
  /** The scope the destination has in the new navigation. */
  scope: DestinationScope;
  /** The menu destination that opens it (the route itself for a `menu` row). */
  destinationPath: string;
  label: string;
  /** The new task group: a System group, a sidebar section, a More group, or the parent page. */
  group: string;
  /** `reached` rows: the parent page, and the source file that links to this route. */
  reachedFrom?: { parent: string; linkedIn: string };
  note?: string;
};

type Menu = readonly [route: string, scope: DestinationScope, oldPlace: RouteMappingRow["oldPlace"], group: string, label: string];

const menuRoutes: readonly Menu[] = [
  // System management groups (systemNavGroups)
  ["/event-setup", "System", "System management", "Events", "Create an event"],
  ["/admin/calendar", "System", "System management", "Events", "Conference calendar"],
  ["/event-setup/copy", "System", "System management", "Events", "Copy from a past event"],
  ["/admin/event-templates", "System", "System management", "Events", "Event templates"],
  ["/archived-events", "System", "System management", "Events", "Archived events"],
  ["/admin/organizations", "System", "System management", "Clubs", "Clubs and churches"],
  ["/admin/clubs/reports", "System", "System management", "Clubs", "Club Monthly Records"],
  ["/admin/clubs/summary", "System", "System management", "Clubs", "Club summary"],
  ["/admin/clubs/applications", "System", "System management", "Clubs", "New club applications"],
  ["/admin/clubs/leaders", "System", "System management", "Clubs", "Club leaders"],
  ["/admin/clubs/transfers", "System", "System management", "Clubs", "Club member transfers"],
  ["/admin/people", "System", "System management", "People", "People & access"],
  ["/admin/forms", "System", "System management", "Forms", "All forms"],
  ["/admin/club-forms", "System", "System management", "Forms", "Club forms"],
  ["/admin/form-templates", "System", "System management", "Forms", "Form templates"],
  ["/admin/question-library", "System", "System management", "Forms", "Question library"],
  ["/admin/information-forms", "System", "System management", "Forms", "Information forms"],
  ["/admin/honors", "System", "System management", "Catalogs and settings", "Honor catalog"],
  ["/admin/club-supplies", "System", "System management", "Catalogs and settings", "Club supply catalog"],
  ["/admin/master-award-rules", "System", "System management", "Catalogs and settings", "Master Award rules"],
  ["/admin/organizations/background-checks", "System", "System management", "Catalogs and settings", "Sterling Volunteers"],
  ["/admin/email", "System", "System management", "Catalogs and settings", "Email"],
  ["/admin/settings", "System", "System management", "Catalogs and settings", "Platform settings"],
  ["/admin/readiness", "System", "System management", "Catalogs and settings", "System readiness"],
  // Event sidebar
  ["/overview", "Event", "Event sidebar", "Daily", "Dashboard"],
  ["/more/kitchen-report/counts", "Event", "Event sidebar", "Daily", "Kitchen counts"],
  ["/check-in", "Event", "Event sidebar", "Daily", "Check-in"],
  ["/people", "Event", "Event sidebar", "Daily", "Registrations"],
  ["/finance", "Event", "Event sidebar", "Daily", "Payments"],
  ["/communications", "Event", "Event sidebar", "Daily", "Emails"],
  ["/more/event-settings", "Event", "Event sidebar", "Set up", "Event settings"],
  ["/more/features", "Event", "Event sidebar", "Set up", "Event features"],
  ["/registration-builder", "Event", "Event sidebar", "Set up", "Registration forms"],
  ["/more/attendee-configuration", "Event", "Event sidebar", "Set up", "Attendee setup"],
  ["/more/tags", "Event", "Event sidebar", "Set up", "Tags"],
  ["/more/reports", "Event", "Event sidebar", "Reports", "Operational reports"],
  ["/more/health", "Event", "Event sidebar", "Reports", "Operational health"],
  // Event pages that are not sidebar items (More directory and parent links)
  ["/people/attendees", "Event", "More directory", "People & clubs", "Attendee list"],
  ["/imports", "Event", "More directory", "People & clubs", "Imports"],
  ["/staff", "Event", "More directory", "People & clubs", "Team"],
  ["/more/promo-codes", "Event", "More directory", "Sales & content", "Promo codes"],
  // /more is a real page (Event modules and activity), not a redirect: the launcher trigger and the launcher footer open it.
  ["/more", "Event", "Event sidebar", "Event tools", "More"],
  // More directory cards
  ["/more/honors", "Event", "More directory", "Event tools", "Honors Weekend classes"],
  ["/more/meals", "Event", "More directory", "Sales & content", "Meals"],
  ["/more/lodging", "Event", "More directory", "Event tools", "Lodging"],
  ["/more/issued-assets", "Event", "More directory", "Event tools", "Issued assets"],
  ["/information-forms", "Event", "More directory", "Event tools", "Information forms"],
  ["/more/program-assignments", "Event", "More directory", "Event tools", "Seminar assignments"],
  ["/more/event-content", "Event", "More directory", "Sales & content", "Public content"],
  ["/more/merchandise", "Event", "More directory", "Sales & content", "Merchandise"],
  ["/community", "Event", "More directory", "Sales & content", "Attendee community"],
  ["/more/clubs", "Event", "More directory", "People & clubs", "This event's clubs"],
  ["/more/club-assignments", "Event", "More directory", "People & clubs", "Club assignments"],
  ["/more/event-patches", "Event", "More directory", "Event tools", "Event patches"],
  ["/more/club-forms", "Event", "More directory", "People & clubs", "Club forms"],
  ["/more/event-health", "Event", "More directory", "People & clubs", "Event health information"],
  ["/more/lodging/assignments", "Event", "More directory", "People & clubs", "Lodging assignments"],
  ["/more/lodging/requests", "Event", "More directory", "People & clubs", "Lodging requests"],
  ["/profile", "Profile", "Account", "Account", "Your account"],
];

/** Other addresses for a menu destination: [route, destination it opens]. All System scope. */
const aliasRoutes: readonly (readonly [route: string, destinationPath: string])[] = [
  ["/admin/clubs/invites", "/admin/clubs/applications"],
  ["/admin/notifications", "/admin/email"],
  ["/admin/background-checks", "/admin/organizations/background-checks"],
  // Team and Accounts became People & access (#1275); both old addresses redirect to it.
  ["/admin/team", "/admin/people"],
  ["/admin/accounts", "/admin/people"],
];

/** Sub-pages reached from a parent page: [route, parent route, source file that links to it]. */
const reachedRoutes: readonly (readonly [route: string, parent: string, linkedIn: string])[] = [
  ["/admin/clubs/health-import", "/admin/organizations", "app/(workspace)/admin/organizations/page.tsx"],
  ["/admin/clubs/import", "/admin/organizations", "app/(workspace)/admin/organizations/page.tsx"],
  ["/admin/organizations/import", "/admin/organizations", "app/(workspace)/admin/organizations/page.tsx"],
  ["/admin/organizations/directory", "/admin/organizations", "app/(workspace)/admin/organizations/page.tsx"],
  ["/admin/organizations/map-locations", "/admin/organizations/directory", "app/(workspace)/admin/organizations/directory/page.tsx"],
  ["/admin/clubs/reports/year-end", "/admin/clubs/reports", "app/(workspace)/admin/clubs/reports/page.tsx"],
  ["/check-in/assets", "/check-in", "components/check-in-workspace.tsx"],
  ["/check-in/badges", "/check-in", "components/check-in-workspace.tsx"],
  ["/check-in/passes", "/check-in", "components/check-in-workspace.tsx"],
  ["/communications/scheduled", "/communications", "components/communications-workspace.tsx"],
  ["/event-setup/from-template", "/event-setup", "app/(workspace)/event-setup/page.tsx"],
  ["/finance/attendance-reconciliation", "/finance", "components/finance-workspace.tsx"],
  ["/finance/billing-responsibility", "/finance", "components/finance-workspace.tsx"],
  ["/finance/cancellation-policy", "/finance", "components/finance-workspace.tsx"],
  ["/finance/cancellation-requests", "/finance", "components/finance-workspace.tsx"],
  ["/finance/church-owed", "/finance", "components/finance-workspace.tsx"],
  ["/finance/invoices", "/finance", "components/finance-workspace.tsx"],
  ["/finance/invoices/statements", "/finance/invoices", "components/invoices.tsx"],
  ["/finance/scholarship-fund", "/finance", "components/finance-workspace.tsx"],
  ["/finance/square-payments", "/finance", "components/finance-workspace.tsx"],
  ["/information-forms/responses", "/information-forms", "modules/information-forms/hub.ts"],
  ["/more/clubs/reports", "/more/clubs", "app/(workspace)/more/clubs/page.tsx"],
  ["/more/ledger-health", "/finance", "components/finance-workspace.tsx"],
  ["/more/honors/instructors", "/more/honors", "components/honors-setup-workspace.tsx"],
  ["/more/honors/rosters", "/more/honors", "components/honors-setup-workspace.tsx"],
  ["/more/honors/schedule", "/more/honors", "components/honors-setup-workspace.tsx"],
  ["/more/issued-assets/closeout", "/more/issued-assets", "components/issued-assets-workspace.tsx"],
  ["/more/kitchen-report", "/more/reports", "app/(workspace)/more/reports/page.tsx"],
  ["/more/kitchen-report/closeout", "/more/kitchen-report", "app/(workspace)/more/kitchen-report/page.tsx"],
  ["/more/kitchen-report/scanner-import", "/more/kitchen-report", "app/(workspace)/more/kitchen-report/page.tsx"],
  ["/more/reports/clubs", "/more/reports", "app/(workspace)/more/reports/page.tsx"],
  ["/more/reports/clubs/check-in-book", "/more/reports/clubs", "app/(workspace)/more/reports/clubs/page.tsx"],
  ["/more/reports/clubs/team-form", "/more/team-results", "components/team-results-workspace.tsx"],
  ["/more/reports/clubs/team-form/level", "/more/team-results", "components/team-results-workspace.tsx"],
  ["/more/reports/packets", "/more/reports", "app/(workspace)/more/reports/page.tsx"],
  ["/more/team-results", "/more/clubs", "app/(workspace)/more/clubs/page.tsx"],
  ["/people/directory-review", "/people", "components/people-workspace.tsx"],
  ["/people/duplicates", "/people", "components/people-workspace.tsx"],
  ["/people/pending-teams", "/people", "components/people-workspace.tsx"],
  ["/people/responsible-adults", "/people", "components/people-workspace.tsx"],
  ["/people/staff-invitations", "/people", "components/people-workspace.tsx"],
  ["/people/staff-invitations/approvals", "/people/staff-invitations", "app/(workspace)/people/staff-invitations/page.tsx"],
];

export function buildRouteMapping(): RouteMappingRow[] {
  const rows: RouteMappingRow[] = [];
  for (const [route, scope, oldPlace, group, label] of menuRoutes) {
    rows.push({ route, kind: "menu", oldPlace, scope, destinationPath: route, label, group });
  }
  for (const [route, destinationPath] of aliasRoutes) {
    rows.push({ route, kind: "alias", oldPlace: "System management", scope: "System", destinationPath, label: `Opens ${destinationPath}`, group: "Alias" });
  }
  for (const [route, parent, linkedIn] of reachedRoutes) {
    rows.push({ route, kind: "reached", oldPlace: "Page link", scope: "Event", destinationPath: parent, label: `Reached from ${parent}`, group: parent, reachedFrom: { parent, linkedIn } });
  }
  rows.push({ route: "/admin", kind: "shell", oldPlace: "System management", scope: "System", destinationPath: "/admin", label: "System administration home", group: "System", note: "Opened from the sidebar's System administration link and the phone System menu bar." });
  rows.push({ route: "/admin/feature-requests", kind: "reached", oldPlace: "System management", scope: "System", destinationPath: "/admin", label: "Feature requests", group: "/admin", reachedFrom: { parent: "/admin", linkedIn: "app/(workspace)/admin/page.tsx" }, note: "System administrators only. Approve or decline event feature requests; the System home only counts them." });
  rows.push({ route: "/help", kind: "shell", oldPlace: "Page link", scope: "Help", destinationPath: "/help", label: "Help & learning", group: "Help", note: "New in #1077. Opened from the sidebar's pinned Help & learning link and from search; every staff member, including staff with no event." });
  rows.push({ route: "/help/glossary", kind: "reached", oldPlace: "Page link", scope: "Help", destinationPath: "/help", label: "Glossary", group: "/help", reachedFrom: { parent: "/help", linkedIn: "app/(workspace)/help/page.tsx" } });
  rows.push({ route: "/events-admin", kind: "shell", oldPlace: "Page link", scope: "Event", destinationPath: "/events-admin", label: "Events Administrator dashboard", group: "Event administration", note: "The Events Administrator's home, opened from the role switcher. Only people with an active EVENT_ADMIN membership see it, and only for those events." });
  rows.push({ route: "/admin/clubs", kind: "shell", oldPlace: "Page link", scope: "System", destinationPath: "/admin/clubs", label: "Clubs Administrator dashboard", group: "Club administration", note: "The Clubs Administrator's home, opened from the role switcher and the Clubs sidebar. Clubs Administrators and system administrators only." });
  rows.push({
    route: "/people/matches", kind: "reached", oldPlace: "Page link", scope: "System", destinationPath: "/people", label: "Possible duplicate people", group: "/people",
    reachedFrom: { parent: "/people", linkedIn: "components/people-workspace.tsx" },
    note: "System administrators only, from the People page's Actions menu; not in the sidebar. Identity merging stays a human decision.",
  });
  return rows;
}

/** Dynamic detail pages: each is opened from a list or parent page, so none is a row above. A new dynamic page fails the page test until it is listed here with its reason. */
export const unmappedDynamicPages: Readonly<Record<string, string>> = {
  "/admin/club-forms/[templateKey]": "Club form builder, opened from Club forms.",
  "/admin/clubs/reports/[organizationId]/[month]": "One club's Monthly Record, opened from Club Monthly Records.",
  "/admin/event-templates/[templateId]": "Edit one event template, opened from Event templates.",
  "/admin/form-templates/[templateKey]": "One form template, opened from Form templates.",
  "/admin/information-forms/[formId]": "One information form, opened from Information forms.",
  "/admin/information-forms/[formId]/responses": "Its responses, opened from the form.",
  "/admin/organizations/[organizationId]/billing": "A club's billing contact, opened from Clubs and churches.",
  "/admin/organizations/[organizationId]/club": "Open one club, from Clubs and churches.",
  "/admin/organizations/[organizationId]/club/honors": "A club's honors, from the club page.",
  "/admin/organizations/[organizationId]/directors": "A club's directors, from the club page.",
  "/admin/organizations/[organizationId]/location": "A church location, from Clubs and churches.",
  "/admin/organizations/[organizationId]/pastor": "A pastor contact, from Clubs and churches.",
  "/admin/organizations/[organizationId]/profile": "A club profile, from Clubs and churches.",
  "/admin/people/[kind]/[id]": "One person's access, opened from People & access.",
  "/finance/invoices/[invoiceId]": "One invoice, opened from Invoices.",
  "/finance/invoices/[invoiceId]/send": "Send one invoice, from the invoice.",
  "/finance/invoices/statements/[partyId]": "One party's statement, from Statements.",
  "/more/club-forms/[submissionId]": "One club form submission, from Club forms.",
  "/more/clubs/[organizationId]": "One club's roster, from This event's clubs.",
  "/more/clubs/reports/[organizationId]/[month]": "One Monthly Record, from the event's club reports.",
  "/help/[guideId]": "One Help & learning guide, opened from the Help hub and from search; only for a viewer who may see it.",
  "/more/health-records/[organizationId]/[memberId]": "One member's health record, opened from the club roster; protected data, so no menu entry.",
  "/more/program-assignments/[runId]": "One assignment run, from Seminar assignments.",
  "/more/reports/clubs/packet/[organizationId]": "One club's packet, from club event reports.",
  "/more/reports/clubs/team-form/[registrationId]": "One team form, from Team results.",
};

const pathOf = (href: string) => href.split("?")[0].split("#")[0];

/** The registries the menus are built from. Injectable so a test can remove a route from one. */
export type RegistrySnapshot = {
  navigationHrefs: readonly string[];
  systemGroups: readonly SystemNavGroup[];
  cardPaths: readonly string[];
};

export function liveRegistries(): RegistrySnapshot {
  const cards = buildMoreDirectoryCards({ permissions: eventPermissions, clubOversight: true, clubEvent: true, isSystemAdmin: true, clubFormsAccess: true, eventQuery: "" });
  return {
    navigationHrefs: [...navigation, eventFeaturesItem].map((item) => item.href),
    systemGroups: systemNavGroups,
    cardPaths: cards.map((card) => pathOf(card.href)),
  };
}

/** Every route the registries list: the event sidebar and More directory, the System groups (and what lights them), and the profile page. */
export function registryRoutes(registries: RegistrySnapshot = liveRegistries()): Set<string> {
  const routes = new Set<string>(["/profile", ...registries.navigationHrefs, ...registries.cardPaths]);
  for (const group of registries.systemGroups) {
    for (const item of group.items) {
      routes.add(item.href);
      for (const alias of item.alsoActiveFor ?? []) routes.add(alias);
    }
  }
  return routes;
}

/** `menu` rows whose route is no longer in the registries. Empty means every mapped menu route is still registered. */
export function missingFromRegistries(rows: readonly RouteMappingRow[], registries: RegistrySnapshot = liveRegistries()): RouteMappingRow[] {
  const present = registryRoutes(registries);
  return rows.filter((row) => row.kind === "menu" && !present.has(row.route));
}

/** Viewers whose menus together must reach every mapped route: an administrator with every permission, and kitchen staff, who hold the counts page instead of the dashboard (#1029). */
export const reachabilityContexts: readonly DestinationSearchContext[] = [
  { isSystemAdmin: true, selectedEventId: "event_synthetic", permissions: eventPermissions, clubOversight: true, clubEvent: true, clubFormsAccess: true },
  { isSystemAdmin: false, selectedEventId: "event_synthetic", permissions: ["MANAGE_KITCHEN_COUNTS"], clubOversight: false, clubEvent: false, clubFormsAccess: false },
];

/** Entry points that are not search destinations: the More page (Event modules and activity) opens from the launcher trigger and, for staff who are not system administrators, from the launcher footer. */
export function launcherEntryPaths(): string[] {
  return launcherFooterLinks({ isSystemAdmin: false, canRequestFeature: true, eventQuery: "" }).map((link) => pathOf(link.href));
}

/** The menu rows (and aliases) whose destination none of the given destination sets opens. Empty means nothing is lost. */
export function unreachableRoutes(
  rows: readonly RouteMappingRow[],
  destinationSets: readonly (readonly SearchDestination[])[],
  extraEventPaths: readonly string[] = launcherEntryPaths(),
): RouteMappingRow[] {
  const opened = new Set(destinationSets.flatMap((set) => set.map((destination) => `${destination.scope}|${pathOf(destination.href)}`)));
  for (const path of extraEventPaths) opened.add(`Event|${path}`);
  return rows.filter((row) => (row.kind === "menu" || row.kind === "alias") && !opened.has(`${row.scope}|${row.destinationPath}`));
}

/** Convenience for the tests: the destination sets of `reachabilityContexts`. */
export function reachabilityDestinationSets(): SearchDestination[][] {
  return reachabilityContexts.map((context) => buildSearchDestinations(context));
}
