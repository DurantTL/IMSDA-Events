import { accountPortalNavItems } from "@/components/account-portal-nav";
import { buildRouteMapping, liveRegistries, registryRoutes, unmappedDynamicPages } from "@/components/route-mapping";
import { areaTabSpecs, railItems, staffAreaOrder, type StaffAreaViewer } from "@/components/staff-areas";
import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import { adminHubs } from "@/components/system-navigation";
import { ADMIN_ROLES } from "@/modules/access/admin-roles-domain";
import { areaClubPortalNavItems, clubPortalNavItems, clubReporterNavItems } from "@/modules/club-rosters/portal-nav";
import { buildHubView, type HubKey, type HubViewer } from "@/modules/system-admin/admin-hubs-model";

/**
 * Page reachability (#1731): every `page.tsx` under `app/(workspace)` and `app/(public)/account/(portal)` has a place in the
 * redesign, or says why it does not need one. Staff and clubs must never need a direct link to find a page.
 *
 * A page is reachable when one of these links to it:
 * - a hub card or hub action (`buildHubView`, for a viewer who holds everything);
 * - the rail or the area tab rows, including their views (`railItems`, `areaTabSpecs`);
 * - the registries behind the menus and search (`registryRoutes`), and the committed route mapping (#1180);
 * - the club portal's, the coordinator's or the attendee account's menu;
 * - a reviewed page, listed in `reviewedPages` below (or `unmappedDynamicPages` in the route mapping) with a reason.
 *
 * This is a source-level guard. Showing a link is never authorization: every page keeps its own server-side check, and a
 * link is gated like the page it opens.
 */
export const pageRoots = [
  { dir: "app/(workspace)", prefix: "" },
  { dir: "app/(public)/account/(portal)", prefix: "/account" },
] as const;

/** The route a `page.tsx` serves, with its dynamic segments left as `[name]`. */
export function routeOfPageFile(root: (typeof pageRoots)[number], relativeDir: string): string {
  const segments = relativeDir.split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return `${root.prefix}/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

const pathOf = (href: string) => decodeURIComponent(href.split("?")[0].split("#")[0]).replace(/\/+$/, "") || "/";

/** A viewer who holds every role and flag, so every gated link is listed. Gating itself is tested next to each menu. */
const everything: StaffAreaViewer = {
  isSystemAdmin: true,
  held: [...ADMIN_ROLES],
  activeRole: null,
  hasEvents: true,
  siteContentEditor: true,
  healthImport: true,
  clubYear: null,
  counts: {},
};
const everyHubViewer: HubViewer = { isSystemAdmin: true, clubsAdmin: true, siteContentEditor: true, healthImport: true };
const hubKeys: HubKey[] = [...(Object.keys(adminHubs) as HubKey[]), "club-administration"];

/** Where each link source goes, by name, so a failure can say which menu a page was (not) found in. */
export function linkedRoutesBySource(): Record<string, Set<string>> {
  const hubs = new Set<string>();
  for (const key of hubKeys) {
    const view = buildHubView(key, everyHubViewer, {});
    for (const card of view.groups.flatMap((group) => group.cards)) hubs.add(pathOf(card.href));
    if (view.action) hubs.add(pathOf(view.action.href));
  }
  const tabs = new Set<string>();
  for (const area of staffAreaOrder) {
    for (const spec of areaTabSpecs[area]) {
      if (spec.destination) tabs.add(pathOf(spec.destination));
      if (spec.href) tabs.add(pathOf(spec.href(everything)));
      for (const view of spec.views ?? []) tabs.add(pathOf(view.href));
    }
  }
  for (const item of railItems(everything, null)) tabs.add(pathOf(item.href));
  const menus = new Set<string>(registryRoutes(liveRegistries()));
  for (const row of buildRouteMapping()) if (row.kind === "menu" || row.kind === "alias" || row.kind === "shell" || row.kind === "reached") menus.add(row.route);
  const portal = new Set<string>();
  const clubBase = "/account/clubs/[organizationId]";
  const leader = { roster: true, registerForEvents: true, seeBirthDates: true, manageTeam: true, editProfile: true, submitReports: true, guardians: true };
  const items = [
    ...clubPortalNavItems({ base: clubBase, role: "DIRECTOR", capabilities: leader }),
    ...clubReporterNavItems({ base: clubBase, capabilities: leader }),
    ...areaClubPortalNavItems({ organizationId: "[organizationId]" }),
    ...coordinatorNavItems({ showWaitlists: true, showTlt: true }),
    ...accountPortalNavItems({ hasAccount: true, directedClubCount: 2, areaCoordinator: true, actingRole: null }),
  ];
  for (const item of items) portal.add(pathOf(item.href));
  return { "hub card or action": hubs, "rail or tab row": tabs, "menu registry or route mapping": menus, "club portal or coordinator menu": portal };
}

/**
 * A page that no menu lists, with the reviewed reason it does not need to be.
 * - `redirect`: the page only sends the visitor on (or answers "not found"); the test requires `redirect(` or `notFound(` in its source.
 * - `linked`: another page links to it. `parent` is that page, `linkedIn` the source file that draws the link and `link` the
 *   text that file must still contain, so deleting the link fails the test. `why` says who sees the link and the page's own
 *   gate, so a reviewer can see the link is gated like the page. A link never grants access: the page checks on the server.
 */
export type ReviewedPage =
  | { kind: "redirect"; why: string }
  | { kind: "linked"; parent: string; linkedIn: string; link: string; why: string };

const club = "/account/clubs/[organizationId]";
const area = "/account/area/[organizationId]";

/** Pages with no place anywhere: not in a link source and not in a reviewed list. Empty means every page has a home. */
export function unreachablePages(
  pages: readonly string[],
  linked: Record<string, Set<string>> = linkedRoutesBySource(),
  reviewed: Readonly<Record<string, unknown>> = { ...unmappedDynamicPages, ...reviewedPages },
): string[] {
  const all = new Set(Object.values(linked).flatMap((set) => [...set]));
  return pages.filter((page) => !all.has(page) && !(page in reviewed));
}

/** The club portal and Area Coordinator pages with no menu entry. The staff dynamic pages are `unmappedDynamicPages` in the route mapping. */
export const reviewedPages: Readonly<Record<string, ReviewedPage>> = {
  "/account/area-clubs": { kind: "redirect", why: "Sends to Overview, the coordinator's first tab." },
  "/account/security": { kind: "redirect", why: "Old address; sends to Profile, where two-step sign-in is." },
  [`${club}/awards`]: { kind: "redirect", why: "Old address; sends to Class tracking." },
  [`${club}/notes`]: { kind: "redirect", why: "Old address; sends to Monthly Records." },
  [`${club}/profile`]: { kind: "redirect", why: "Old address; sends to Club settings." },
  [`${club}/team`]: { kind: "redirect", why: "Old address; sends to Club settings." },
  [`${club}/supplies`]: { kind: "redirect", why: "Old address; sends to Orders, where supplies on hand are." },
  [`${club}/reports`]: { kind: "redirect", why: "Old address; sends to Monthly Records." },
  [`${club}/reports/[month]`]: { kind: "redirect", why: "Old address; sends to that month in Monthly Records." },
  [`${club}/exports`]: { kind: "redirect", why: "Old address; sends to Honors." },
  [`${area}/orders`]: { kind: "redirect", why: "A coordinator never sees club Orders (#918); the page answers not found." },
  [`${area}/supplies`]: { kind: "redirect", why: "A coordinator never sees club supplies (#918); the page answers not found." },
  "/account/area/health": { kind: "linked", parent: "/account/area-clubs/overview", linkedIn: "modules/club-reports/area-card-domain.ts", link: "/account/area/health", why: "The Event health information card on the coordinator's Overview; the page does its own switch, step and window checks." },
  "/account/area-clubs/reports/export": { kind: "linked", parent: "/account/area-clubs/reports", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/reports/export?year=", why: "The More export options link beside the full-year CSV on Monthly Records and Points (#1761)." },
  "/account/area-clubs/tlt/forms": { kind: "linked", parent: "/account/area-clubs/tlt", linkedIn: "components/tlt-directory.tsx", link: "/account/area-clubs/tlt/forms", why: "The TLT forms button on the TLT directory (#1686); the page does its own TLT director check and answers not found to anyone else." },
  "/account/area-clubs/tlt/forms/[submissionId]": { kind: "linked", parent: "/account/area-clubs/tlt/forms", linkedIn: "components/tlt-forms-inbox.tsx", link: "/account/area-clubs/tlt/forms", why: "The Open button on each card of the TLT forms inbox (#1686); the page does its own TLT director check, reads only the three TLT forms, and records every opening." },
  "/account/area-clubs/tlt/lists": { kind: "linked", parent: "/account/area-clubs/tlt", linkedIn: "components/tlt-directory.tsx", link: "/account/area-clubs/tlt/lists", why: "The Manage lists button on the TLT directory (#1686); the page does its own TLT director check." },
  "/account/area-clubs/tlt/staffing": { kind: "linked", parent: "/account/area-clubs/tlt", linkedIn: "components/tlt-directory.tsx", link: "/account/area-clubs/tlt/staffing", why: "The TLT staffing button on the TLT directory (#1678); the page does its own TLT director check and answers not found to anyone else." },
  "/account/area-clubs/tlt/staffing/[eventId]": { kind: "linked", parent: "/account/area-clubs/tlt/staffing", linkedIn: "app/(public)/account/(portal)/area-clubs/tlt/staffing/page.tsx", link: "/account/area-clubs/tlt/staffing/${encodeURIComponent(event.id)}", why: "The Assign TLTs button on each event of the TLT staffing list (#1678); the page does its own TLT director check." },
  "/account/area-clubs/roster-export": { kind: "linked", parent: "/account/area-clubs/overview", linkedIn: "components/coordinator-overview.tsx", link: "/account/area-clubs/roster-export?year=", why: "The Export rosters link in Clubs at a glance (#1760), also linked from the Clubs page and each club's view-only page." },
  "/account/area-clubs/events/[eventId]": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}", why: "A button on each row of the Club events list, for the signed-in Area Coordinator (#1731)." },
  "/account/area-clubs/events/[eventId]/report": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/report", why: "A button on each row of the Club events list, for the signed-in Area Coordinator (#1731)." },
  "/account/area-clubs/events/[eventId]/inspections": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/inspections", why: "The Inspections button on each Club events row (#1896)." },
  "/account/area-clubs/events/[eventId]/scoring": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/scoring", why: "The Camporee scoring button on each Club events row (#1676)." },
  "/account/area-clubs/events/[eventId]/attendance-points": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/attendance-points", why: "The Attendance points button on each Club events row (#1677)." },
  "/account/area-clubs/events/[eventId]/debrief": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/debrief", why: "The Event debrief button on each Club events row (#1679)." },
  "/account/area-clubs/events/[eventId]/budget": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/budget", why: "The Budget sheet button on each Club events row (#1682)." },
  "/account/area-clubs/events/[eventId]/staffing": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/events/${encodeURIComponent(event.id)}/staffing", why: "The Event staffing button on each Club events row (#1678)." },
  "/account/area-clubs/kitchen/[eventId]": { kind: "linked", parent: "/account/area-clubs/events", linkedIn: "components/coordinator-destinations.tsx", link: "/account/area-clubs/kitchen/${encodeURIComponent(event.id)}", why: "The Kitchen report button on each Club events row." },
  "/account/area-clubs/health/[eventId]/[organizationId]/[memberId]": { kind: "linked", parent: "/account/area/health", linkedIn: "modules/coordinator-health/domain.ts", link: "/account/area-clubs/health/", why: "One attendee's Health Record, opened from the event health sheet; the page does its own checks." },
  [`${area}/forms/[submissionId]`]: { kind: "linked", parent: `${area}/forms`, linkedIn: "app/(public)/account/(portal)/area/[organizationId]/forms/page.tsx", link: "/forms/${row.id}", why: "The View button on each row of the coordinator's Club forms list." },
  [`${area}/reports/[month]`]: { kind: "linked", parent: "/account/area-clubs/reports", linkedIn: "components/coordinator-monthly-records.tsx", link: "/reports/${month}", why: "Opens one club's Monthly Record from the coordinator's Monthly Records table." },
  "/account/club-registration/[eventSlug]": { kind: "linked", parent: club, linkedIn: "modules/club-registrations/entry-path.ts", link: "/account/club-registration/", why: "The club registration entry address that notices and the club's event pages use; the page checks the director's access." },
  "/account/help/[guideId]": { kind: "linked", parent: "/account/help", linkedIn: "app/(public)/account/(portal)/help/portal-help-search.tsx", link: "/account/help/", why: "One guide, opened from the portal Help list and its search." },
  "/account/instructor": { kind: "linked", parent: "/account", linkedIn: "app/(public)/account/(portal)/page.tsx", link: "/account/instructor", why: "Opened from the account Overview for an invited honors instructor; the page sends everyone else to Overview." },
  "/account/instructor/[offeringId]": { kind: "linked", parent: "/account/instructor", linkedIn: "app/(public)/account/(portal)/instructor/page.tsx", link: "/account/instructor/", why: "One class, from the instructor's list." },
  "/account/visiting-club/[token]": { kind: "linked", parent: "/account", linkedIn: "modules/visiting-clubs/domain.ts", link: "/account/visiting-club/", why: "Reached only from the private link emailed to a visiting club's director (#835); the page needs the signed-in account whose verified email the link was sent to, and a bad link is not found." },
  "/account/clubs/choose": { kind: "linked", parent: "/account", linkedIn: "modules/club-forms/public-index-domain.ts", link: "/account/clubs/choose?to=", why: "Opened from the public club forms index for a director who has several clubs; the page takes a fixed target key, never a path." },
  [`${club}/class-tracking/[personId]`]: { kind: "linked", parent: `${club}/class-tracking`, linkedIn: "components/club-earned-awards-workspace.tsx", link: "href={`${classHistoryBase}/", why: "A member's class history, from Class tracking and the roster (director and deputy)." },
  [`${club}/events/[eventId]`]: { kind: "linked", parent: `${club}/events`, linkedIn: "modules/club-rosters/home-view.ts", link: "`${base}/events/${event.id}`", why: "One club event, from the club home and the Club events list." },
  [`${club}/events/[eventId]/packet`]: { kind: "linked", parent: `${club}/events/[eventId]`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx", link: "/events/${eventId}/packet${teamQuery}", why: "The club's event packet, from the event page." },
  [`${club}/events/[eventId]/schedule`]: { kind: "linked", parent: `${club}/events/[eventId]`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx", link: "/events/${eventId}/schedule`", why: "Everyone's classes by session, from the event page." },
  [`${club}/events/[eventId]/team-form`]: { kind: "linked", parent: `${club}/events/[eventId]`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx", link: "href={`${eventBase}/team-form${teamQuery}`}", why: "The team form, from the event page." },
  [`${club}/events/[eventId]/team-form/blank`]: { kind: "linked", parent: `${club}/events/[eventId]`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx", link: "href={`${eventBase}/team-form/blank`}", why: "A blank team form to mail or email, from the event page." },
  [`${club}/exports/class-tracking`]: { kind: "linked", parent: `${club}/class-tracking`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/page.tsx", link: "exportPrintHref={`/account/clubs/${organizationId}/exports/class-tracking`}", why: "The print and export page, opened from Class tracking's export controls." },
  [`${club}/exports/honors`]: { kind: "linked", parent: `${club}/honors`, linkedIn: "components/club-honors-workspace.tsx", link: "href={`${base}/exports/honors`}", why: "The honors export, from the Honors page." },
  [`${club}/forms/[templateKey]/new`]: { kind: "linked", parent: `${club}/forms`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx", link: "href={`${base}/${template.key}/new`}", why: "Start a form button on the Forms page (director and deputy)." },
  [`${club}/forms/outings/new`]: { kind: "linked", parent: `${club}/forms`, linkedIn: "components/club-outings-section.tsx", link: "href={`${base}/outings/new`}", why: "New outing slip, in the Forms page's outing section (#1731); the page checks the director and deputy role." },
  [`${club}/forms/outings/[outingId]`]: { kind: "linked", parent: `${club}/forms`, linkedIn: "components/club-outing-tables.tsx", link: "/outings/${row.id}", why: "Open on each outing in the Forms page's outing list." },
  [`${club}/forms/outings/[outingId]/print`]: { kind: "linked", parent: `${club}/forms/outings/[outingId]`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/forms/outings/[outingId]/page.tsx", link: "href={`${base}/outings/${outingId}/print`}", why: "Print, on the outing page." },
  [`${club}/forms/submissions/[submissionId]`]: { kind: "linked", parent: `${club}/forms`, linkedIn: "components/club-forms-lists.tsx", link: "/submissions/${row.id}", why: "Open on each submitted form in the Forms page." },
  [`${club}/forms/submissions/[submissionId]/roster`]: { kind: "linked", parent: `${club}/forms/submissions/[submissionId]`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/forms/submissions/[submissionId]/page.tsx", link: "href={`${base}/submissions/${submissionId}/roster`}", why: "Add to roster, on the submission page, for a form whose template allows it (director and deputy)." },
  [`${club}/orders/print`]: { kind: "linked", parent: `${club}/orders`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/orders/page.tsx", link: "printHref={`/account/clubs/${organizationId}/orders/print`}", why: "Print, on the Orders page." },
  [`${club}/reports/year-end/[year]`]: { kind: "linked", parent: `${club}/records`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx", link: "/reports/year-end/${year}", why: "The Year-End Report, from Monthly Records (submitting reports only)." },
  [`${club}/roster/[memberId]/health`]: { kind: "linked", parent: `${club}/roster`, linkedIn: "components/club-roster-workspace.tsx", link: "/roster/${encodeURIComponent(member.id)}/health`", why: "One member's health record, from the roster (director and deputy); protected data, so no menu entry." },
  [`${club}/roster/export`]: { kind: "linked", parent: `${club}/roster`, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx", link: "href={`/account/clubs/${organizationId}/roster/export`}", why: "Build a roster export, on the roster page." },
  [`${club}/roster/next-year`]: { kind: "linked", parent: `${club}/roster`, linkedIn: "components/club-next-year-offer.tsx", link: "/roster/next-year", why: "Start next year's roster, offered on the club home and roster." },
  [`${club}/roster-health`]: { kind: "linked", parent: club, linkedIn: "app/(public)/account/(portal)/clubs/[organizationId]/page.tsx", link: "href={`${base}/roster-health`}", why: "The Roster health card on the club home and an Open roster health button on the Roster page, shown only to the director and deputy while the club has the feature on (#1731); Club settings links it too." },
};

/** Source lines that can hold a real link: not an import, a re-export or a comment. */
function codeLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(import\b|export\b[^=(]*\bfrom\b|\} from\b|\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/** Whether a reviewed entry's link text is still drawn by the file, ignoring imports and comments (an import path is not a link). */
export function linkIsDrawn(source: string, link: string): boolean {
  return codeLines(source).includes(link);
}

/** Whether a page only redirects or answers not found: it calls one of them and returns no markup. */
export function pageOnlyRedirects(source: string): boolean {
  const code = codeLines(source);
  return /\b(?:redirect|permanentRedirect|notFound)\(/.test(code) && !/return\s*\(?\s*</.test(code) && !/=>\s*\(?\s*</.test(code);
}
