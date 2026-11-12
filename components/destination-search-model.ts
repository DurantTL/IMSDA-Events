import {
  buildMoreDirectoryCards,
  clubsAdminGroups,
  clubsAdminHealthImportHref,
  clubsAdminRecordsHref,
  clubsAdminHomeItem,
  eventFeaturesItem,
  matchesVisibility,
  navigation,
  sidebarSections,
  withCurrentEvent,
  type NavigationItem,
} from "@/components/staff-navigation";
import { visibleReachedDestinations } from "@/components/reached-destinations";
import { systemNavGroups } from "@/components/system-navigation";
import type { EventPermission } from "@/modules/access/permissions";
import { alwaysOnModuleKeys, disabledModuleCardKeys } from "@/modules/event-modules/catalog";
import { visibleGuides } from "@/modules/help/visibility";
import type { StaffSearchResult } from "@/modules/staff-search/domain";

/**
 * Destination search (#1177, slice A of #1074). It searches the canonical
 * destination registry only: the System groups (`systemNavGroups`), the event
 * sidebar and More directory (`navigation`, `buildMoreDirectoryCards`) and the
 * staff profile page. It never reads attendee or protected data, private event
 * names, answers or credentials: every searchable word below is a label,
 * description or keyword written in code.
 *
 * What a person may find is exactly what the menus already show them: the same
 * permission rule (`matchesVisibility`), the same module gating (#741, through
 * `hiddenCardKeys`) and the same system-administrator rule. A destination the
 * viewer cannot open is never built, so it can never be a result. Every page and
 * route handler keeps its own server authorization; nothing here grants access.
 * Planned features are not in the registry, so they cannot appear.
 */
export type DestinationScope = "System" | "Clubs" | "Event" | "Profile" | "Help";

export type SearchDestination = {
  /** Stable per scope and path, used as the option id and React key. */
  key: string;
  scope: DestinationScope;
  label: string;
  /** The menu group a page with no menu entry lives under (#1661), shown before the label and searchable. */
  parent?: string;
  description: string;
  href: string;
  /** Extra task words that find this destination but are not shown. */
  keywords: readonly string[];
};

export type DestinationSearchContext = {
  isSystemAdmin: boolean;
  /** The selected event, or "" when none; event destinations need one. */
  selectedEventId: string;
  /** The viewer's permissions for the selected event. */
  permissions: readonly EventPermission[];
  clubOversight: boolean;
  clubEvent: boolean;
  clubFormsAccess: boolean;
  /** Cards hidden for the selected event by the module rules (#741). */
  hiddenCardKeys?: ReadonlySet<string>;
  /**
   * Set only while the Clubs Administrator view of the role switcher is showing (#1245): the Clubs sidebar's
   * destinations become searchable. `healthImport` is false when the Health Record feature is off, as in the sidebar.
   */
  clubsAdmin?: { healthImport: boolean };
  /** An active Site content editor who is not a system administrator (#111): Homepage & site content is searchable. */
  siteContentEditor?: boolean;
  /** An active Youth Admin who is not a system administrator (#1685): the Youth directory is searchable. A system administrator already has it in the System destinations. */
  youthDirectory?: boolean;
};

/** What each scope means, for the label beside a result. */
export const destinationScopeLabels: Record<DestinationScope, string> = {
  System: "System",
  Clubs: "Clubs",
  Event: "Event",
  Profile: "Profile",
  Help: "Help",
};

/** The text a screen reader hears for a result's scope. */
export function destinationScopeDescription(scope: DestinationScope): string {
  switch (scope) {
    case "System": return "System administration";
    case "Clubs": return "Clubs administration";
    case "Event": return "The selected event";
    case "Profile": return "Your account";
    case "Help": return "Help & learning guide";
  }
}

const pathOf = (href: string) => href.split("?")[0].split("#")[0];

/** Task words by destination path (no query string). Words people use that the label does not. */
const destinationKeywords: Record<string, readonly string[]> = {
  "/admin/events": ["all events", "every event", "event list", "events directory", "find an event", "current events"],
  "/event-setup": ["new event", "add event", "start event", "build event"],
  "/admin/calendar": ["calendar", "conference calendar", "public calendar", "calendar item", "visitors"],
  "/event-setup/copy": ["copy event", "duplicate event", "clone event", "last year", "previous event", "rollover"],
  "/admin/event-templates": ["template", "starting point", "new event"],
  "/archived-events": ["archive", "finished events", "old events", "past events", "put away"],
  "/admin/organizations": ["church", "churches", "club directory", "organizations", "directors"],
  "/admin/youth": ["youth", "pathfinders", "grade", "school", "school type", "outreach", "church member", "directory"],
  "/admin/clubs": ["clubs dashboard", "what is waiting", "club year"],
  "/admin/clubs/reports": ["review monthly records", "records to review", "review records", "club reports"],
  [clubsAdminRecordsHref]: ["monthly record", "monthly records", "club reports", "records"],
  "/admin/clubs/reports/year-end": ["year end", "pathfinder year", "annual report"],
  "/admin/clubs/leaders": ["club invites", "invite club", "club invitation", "director invite", "waiting invites"],
  "/admin/clubs/import": ["upload clubs", "csv", "bulk clubs"],
  "/admin/clubs/health-import": ["medical", "upload health", "csv"],
  "/admin/clubs/summary#points": ["points", "scores", "standings"],
  "/admin/clubs/summary#club-events": ["club events", "registered clubs", "next event"],
  "/admin/clubs/summary": ["club overview", "club health"],
  "/admin/clubs/applications": ["invite club", "new club", "club invite", "application"],
  "/admin/clubs/transfers": ["move member", "transfer member"],
  "/admin/people": ["invite staff", "add staff", "staff access", "permissions", "roles", "who can", "sign in", "login", "password", "user accounts", "team", "accounts"],
  "/admin/health-access": ["break glass", "legal hold", "hold", "health access", "grants", "monthly review", "medical"],
  "/admin/forms": ["questions", "survey"],
  "/admin/club-forms": ["membership", "permission slip"],
  "/admin/form-templates": ["registration form", "form template"],
  "/admin/question-library": ["saved questions", "reusable questions"],
  "/admin/information-forms": ["survey", "interest form"],
  "/admin/honors": ["honor", "honors catalog"],
  "/admin/club-supplies": ["supply", "ordering", "store"],
  "/admin/master-award-rules": ["master award", "award rules"],
  "/admin/organizations/background-checks": ["sterling", "screening", "volunteer screening", "clearance"],
  "/admin/email": ["mail", "sender", "notification", "paused events", "staff alerts", "email health"],
  "/admin/site-content": ["homepage", "home page", "public site", "notices", "announcements", "banner", "footer", "navigation links", "featured events", "emergency notice"],
  "/admin/analytics": ["analytics", "statistics", "page views", "traffic", "funnel", "sign-in rate", "broken links", "web vitals"],
  "/admin/settings": ["platform", "configuration", "preferences", "options", "sign-in settings", "payment settings"],
  "/admin/readiness": ["ready", "checklist", "go live", "launch"],
  "/admin/system-report": ["health", "status", "report", "problems", "errors", "monitoring"],
  "/admin/pauses": ["pause", "maintenance", "stop registration", "stop payments", "outage", "freeze", "turn off"],
  "/profile": ["account", "password", "multi-factor", "mfa", "security", "my details", "sign in"],
  "/overview": ["home", "dashboard", "summary"],
  "/check-in": ["arrival", "scan", "badge"],
  "/people": ["attendees", "registrations", "guests", "who is coming"],
  "/finance": ["payments", "money", "balance", "invoice", "billing"],
  "/communications": ["email", "mail", "message", "announcement", "send"],
  "/more/event-settings": ["settings", "dates", "location", "capacity", "publish", "configuration"],
  "/registration-builder": ["form", "questions", "registration form"],
  "/more/attendee-configuration": ["attendee types", "pricing", "prices"],
  "/more/tags": ["labels", "color"],
  "/more/reports": ["reports", "rosters", "totals", "print"],
  "/more/health": ["exceptions", "problems", "failed", "delays"],
  "/more/features": ["modules", "turn on", "turn off", "features"],
  "/staff": ["invite staff", "add staff", "staff access", "permissions", "roles", "volunteers"],
  "/imports": ["csv", "upload", "import"],
  "/more/promo-codes": ["discount", "coupon", "promo"],
  "/people/attendees": ["attendee list", "dietary", "csv", "download"],
  "/more/lodging": ["rooms", "beds", "housing", "sites"],
  "/more/lodging/assignments": ["rooming", "housing", "place guests"],
  "/more/lodging/requests": ["roommate", "housing requests"],
  "/more/meals": ["food", "cafe", "dining", "tickets"],
  "/more/kitchen-report/counts": ["kitchen", "meals", "food counts"],
  "/more/merchandise": ["shirts", "products", "store", "shop"],
  "/information-forms": ["survey", "interest form", "questionnaire", "answers only", "no payment"],
  "/more/club-forms": ["membership", "permission slip", "passenger list"],
  "/more/clubs": ["churches", "directors", "rosters"],
  "/more/event-content": ["public page", "speakers", "schedule", "downloads"],
};

/** Descriptions for the event sidebar items that have no More card of their own. */
const sidebarDescriptions: Record<string, string> = {
  "/overview": "The event dashboard: registrations, payments and what needs attention.",
  "/more/kitchen-report/counts": "Enter the day's meal counts for the kitchen.",
  "/check-in": "Check attendees in as they arrive.",
  "/people": "Find a registration and see who is coming.",
  "/finance": "Payments, balances and adjustments for this event.",
  "/communications": "Write and send email to this event's attendees.",
  "/more/features": "Turn this event's features on and off, or ask for one.",
};

function eventDescriptionFor(item: NavigationItem): string {
  return sidebarDescriptions[item.href] ?? `${item.label} for the selected event.`;
}

/** The review list behind the Monthly Records tab (#1552): its own entry, since no menu item opens it directly. */
function reviewMonthlyRecordsDestination(scope: "System" | "Clubs", key: string, group: string, selectedEventId?: string | null): SearchDestination {
  return {
    key,
    scope,
    label: "Review monthly records",
    description: `Submitted Monthly Records waiting for review, by club and month${scope === "Clubs" ? " in club administration" : ""}.`,
    href: scope === "System" ? withCurrentEvent("/admin/clubs/reports", selectedEventId) : "/admin/clubs/reports",
    keywords: [...(destinationKeywords["/admin/clubs/reports"] ?? []), group],
  };
}

/**
 * Every destination this viewer may open, in menu order: System, then Clubs (in the Clubs view), then Event,
 * then Profile. Built from the same registry and rules as the menus.
 */
export function buildSearchDestinations(context: DestinationSearchContext): SearchDestination[] {
  const destinations: SearchDestination[] = [];
  const systemPaths = new Set<string>();
  const seen = new Set<string>();
  const add = (destination: SearchDestination) => {
    const identity = `${destination.scope}:${destination.label}:${pathOf(destination.href)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    destinations.push(destination);
  };

  if (context.isSystemAdmin) {
    for (const group of systemNavGroups) {
      for (const item of group.items) {
        systemPaths.add(item.href);
        add({
          key: `System:${group.key}:${item.href}`,
          scope: "System",
          label: item.label,
          description: item.description,
          href: withCurrentEvent(item.href, context.selectedEventId),
          keywords: [...(destinationKeywords[item.href] ?? []), group.label],
        });
      }
    }
    add(reviewMonthlyRecordsDestination("System", "System:review-monthly-records", "Clubs", context.selectedEventId));
  }

  if (context.siteContentEditor && !context.isSystemAdmin) {
    add({
      key: "System:site-content:/admin/site-content",
      scope: "System",
      label: "Homepage & site content",
      description: "Notices, announcements, featured events, header links and the footer on the public pages.",
      href: "/admin/site-content",
      keywords: destinationKeywords["/admin/site-content"] ?? [],
    });
  }

  if (context.youthDirectory && !context.isSystemAdmin) {
    add({
      key: "Clubs:youth-directory:/admin/youth",
      scope: "Clubs",
      label: "Youth directory",
      description: "Every active youth on a club roster by grade, school type and club, with counts and a CSV export.",
      href: "/admin/youth",
      keywords: destinationKeywords["/admin/youth"] ?? [],
    });
  }

  if (context.clubsAdmin) {
    // The Clubs sidebar's own destinations, with the group as context. Never built outside the Clubs view.
    const clubsHome = { label: clubsAdminHomeItem.label, href: clubsAdminHomeItem.href, group: null as string | null };
    const clubItems = [
      clubsHome,
      ...clubsAdminGroups.flatMap((group) => group.items.map((item) => ({ label: item.label, href: item.href, group: group.label }))),
    ].filter((item) => item.href !== clubsAdminHealthImportHref || context.clubsAdmin?.healthImport !== false);
    add(reviewMonthlyRecordsDestination("Clubs", "Clubs:review-monthly-records", "Records and points"));
    for (const item of clubItems) {
      // A page the System groups already list (Club summary, Monthly Records) stays one result, in System scope.
      if (systemPaths.has(item.href)) continue;
      add({
        key: `Clubs:${item.href}`,
        scope: "Clubs",
        label: item.label,
        description: item.group ? `${item.group} in club administration.` : "What is waiting across every club, then the clubs themselves.",
        href: item.href,
        keywords: [...(destinationKeywords[item.href] ?? destinationKeywords[pathOf(item.href)] ?? []), ...(item.group ? [item.group] : [])],
      });
    }
  }

  // Pages with no menu entry (#1661), each only for a viewer who passes the page's own check.
  const reached = visibleReachedDestinations(context);
  // System pages need no event. A page a System menu item already lists stays one result.
  for (const entry of reached.filter((candidate) => candidate.scope === "System")) {
    if (systemPaths.has(entry.route)) continue;
    // A Clubs Administrator who is not a system administrator opens it as club administration, not System.
    const scope = context.isSystemAdmin ? "System" : "Clubs";
    add({
      key: `${scope}:${entry.route}`,
      scope,
      label: entry.label,
      parent: entry.parent,
      description: entry.description,
      href: withCurrentEvent(entry.route, context.selectedEventId),
      keywords: entry.keywords,
    });
  }

  if (context.selectedEventId) {
    const eventId = context.selectedEventId;
    const eventQuery = `?event=${encodeURIComponent(eventId)}`;
    const permissions = new Set(context.permissions);
    const addEvent = (path: string, label: string, description: string, href: string) => {
      // A System page already listed (Clubs and churches) stays one result, in System scope.
      if (systemPaths.has(pathOf(href))) return;
      add({ key: `Event:${path}`, scope: "Event", label, description, href, keywords: destinationKeywords[path] ?? [] });
    };

    // The sidebar's own items, under the sidebar's own visibility rule.
    const sidebarItems = sidebarSections(permissions).flatMap((view) => view.items);
    // Items that are not sidebar items but are in the registry (Team, Imports, ...), under the same rule.
    const otherItems = navigation.filter((item) => !item.sidebar && item.href !== "/more" && matchesVisibility(item, permissions));
    const cards = buildMoreDirectoryCards({
      permissions: context.permissions,
      clubOversight: context.clubOversight,
      clubEvent: context.clubEvent,
      isSystemAdmin: context.isSystemAdmin,
      clubFormsAccess: context.clubFormsAccess,
      eventQuery,
      // A missing module state is fail-closed: only the always-on modules count as on.
      hiddenCardKeys: context.hiddenCardKeys ?? disabledModuleCardKeys(new Set(alwaysOnModuleKeys)),
    }).filter((card) => card.allowed);
    const cardByPath = new Map(cards.map((card) => [pathOf(card.href), card]));

    for (const item of [...sidebarItems, ...otherItems]) {
      // The Dashboard page itself needs the event view; the sidebar is looser, and a result must be one the viewer can open.
      if (item.href === "/overview" && !permissions.has("VIEW_EVENT")) continue;
      const card = cardByPath.get(item.href);
      addEvent(item.href, item.label, card?.description ?? eventDescriptionFor(item), withCurrentEvent(item.href, eventId));
    }
    // Cards that are not nav items (Honors, Lodging, Meals, ...). The nav label wins for the ones that are.
    for (const card of cards) {
      const path = pathOf(card.href);
      const navItem = [eventFeaturesItem, ...navigation].find((item) => item.href === path);
      addEvent(path, navItem?.label ?? card.title, card.description, card.href);
    }

    // Event pages with no menu entry (#1661): each only for a viewer who passes the page's own check, after every menu item.
    const listed = new Set(destinations.filter((destination) => destination.scope === "Event").map((destination) => pathOf(destination.href)));
    for (const entry of reached.filter((candidate) => candidate.scope === "Event")) {
      if (listed.has(entry.route) || systemPaths.has(entry.route)) continue;
      add({
        key: `Event:${entry.route}`,
        scope: "Event",
        label: entry.label,
        parent: entry.parent,
        description: entry.description,
        href: withCurrentEvent(entry.route, eventId),
        keywords: entry.keywords,
      });
    }
  }

  // Every signed-in staff member has a profile page.
  add({
    key: "Profile:/profile",
    scope: "Profile",
    label: "Your account",
    description: "Your name, sign-in and security settings.",
    href: "/profile",
    keywords: destinationKeywords["/profile"] ?? [],
  });

  // Help & learning (#1077): the hub, the glossary and the guides this viewer may see. Static titles and keywords
  // written in code, never event data. They are listed after every matching page (see `searchDestinations`).
  const helpViewer = { isSystemAdmin: context.isSystemAdmin, selectedEventId: context.selectedEventId, permissions: context.permissions };
  add({ key: "Help:/help", scope: "Help", label: "Help & learning", description: "Short guides for common tasks.", href: withCurrentEvent("/help", context.selectedEventId), keywords: ["guide", "how to", "learn", "training", "support"] });
  for (const guide of visibleGuides(helpViewer)) {
    add({ key: `Help:/help/${guide.id}`, scope: "Help", label: guide.title, description: guide.summary, href: withCurrentEvent(`/help/${guide.id}`, context.selectedEventId), keywords: guide.keywords });
  }
  add({ key: "Help:/help/glossary", scope: "Help", label: "Glossary", description: "What the words in the workspace mean.", href: withCurrentEvent("/help/glossary", context.selectedEventId), keywords: ["terms", "words", "meaning", "definitions", "jargon"] });
  return destinations;
}

/**
 * Words that mean the same thing to the people searching. A query word matches
 * a destination when it, or any word in its group, starts a word in the label,
 * description or keywords.
 */
const synonymGroups: readonly (readonly string[])[] = [
  ["setting", "configure", "configuration", "preference", "option", "platform"],
  ["email", "mail", "message", "notification", "announcement", "newsletter"],
  ["staff", "team", "volunteer"],
  ["invite", "invitation"],
  ["copy", "duplicate", "clone"],
  ["create", "new", "start", "build"],
  ["report", "record", "summary", "total"],
  ["payment", "pay", "finance", "money", "billing", "balance"],
  ["club", "church", "organization"],
  ["form", "question", "survey"],
  ["archive", "archived", "old", "past"],
  ["account", "profile", "password", "login"],
  ["attendee", "guest", "registration", "registrant"],
  ["discount", "coupon", "promo"],
];

/** Lowercase word stem: letters and digits only, a plural `s` dropped. */
function stem(word: string): string {
  const clean = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean.length > 3 && clean.endsWith("s") ? clean.slice(0, -1) : clean;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
}

function expansionsOf(token: string): string[] {
  const base = stem(token);
  const expanded = new Set([base]);
  for (const group of synonymGroups) {
    if (group.some((word) => stem(word) === base)) for (const word of group) expanded.add(stem(word));
  }
  return [...expanded];
}

const startsAnyWord = (words: readonly string[], candidate: string) => words.some((word) => word.startsWith(candidate));

/** A destination's relevance to the query, or 0 when any query word finds nothing. */
function scoreDestination(destination: SearchDestination, tokens: readonly string[]): number {
  const labelWords = wordsOf(destination.label);
  const keywordWords = wordsOf([...destination.keywords, destination.parent ?? ""].join(" "));
  const descriptionWords = wordsOf(destination.description);
  const scopeWords = wordsOf(destination.scope);
  let total = 0;
  for (const token of tokens) {
    const direct = stem(token);
    let best = 0;
    for (const candidate of expansionsOf(token)) {
      const isDirect = candidate === direct;
      if (labelWords.includes(candidate)) best = Math.max(best, isDirect ? 8 : 5);
      else if (startsAnyWord(labelWords, candidate)) best = Math.max(best, isDirect ? 6 : 4);
      else if (startsAnyWord(keywordWords, candidate)) best = Math.max(best, isDirect ? 4 : 3);
      else if (startsAnyWord(descriptionWords, candidate)) best = Math.max(best, isDirect ? 2 : 1);
      else if (isDirect && scopeWords.includes(candidate)) best = Math.max(best, 1);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export const maxDestinationResults = 8;

/**
 * Destinations matching the query, best first (ties keep menu order). An empty
 * query matches nothing: the search is for people who know what they want.
 */
export function searchDestinations(
  destinations: readonly SearchDestination[],
  query: string,
  limit = maxDestinationResults,
): SearchDestination[] {
  const tokens = query.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const ranked = destinations
    .map((destination, index) => ({ destination, index, score: scoreDestination(destination, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.destination);
  // Help guides (#1077) follow every page that matches, but keep up to two places when pages fill the list.
  const guides = ranked.filter((destination) => destination.scope === "Help");
  const pages = ranked.filter((destination) => destination.scope !== "Help");
  const reserved = Math.min(guides.length, 2);
  return [...pages.slice(0, limit - reserved), ...guides.slice(0, Math.max(reserved, limit - pages.length))];
}

/** The order the sidebar and menus list the scopes in. */
const scopeOrder: readonly DestinationScope[] = ["System", "Clubs", "Event", "Profile", "Help"];

/**
 * Every destination the viewer may open (#1347), grouped by scope in menu order: what an empty, focused box lists. It
 * only reorders the permission-filtered set it is given (stable within a scope), so it can never show a destination
 * `buildSearchDestinations` did not build, and it applies no result limit.
 */
export function allDestinations(destinations: readonly SearchDestination[]): SearchDestination[] {
  return scopeOrder.flatMap((scope) => destinations.filter((destination) => destination.scope === scope));
}

/** The list for a query: ranked matches when words are typed, else every destination, grouped. */
export function listDestinations(destinations: readonly SearchDestination[], query: string): SearchDestination[] {
  return hasSearchWords(query) ? searchDestinations(destinations, query) : allDestinations(destinations);
}

/** Whether a query holds any word to search for (letters or digits). */
export function hasSearchWords(query: string): boolean {
  return /[\p{L}\p{N}]/u.test(query);
}

/** The scope groups of a list that is already in `allDestinations` order, each with its starting index in the list. */
export function groupDestinationsByScope(list: readonly SearchDestination[]): { scope: DestinationScope; start: number; items: SearchDestination[] }[] {
  const groups: { scope: DestinationScope; start: number; items: SearchDestination[] }[] = [];
  list.forEach((destination, index) => {
    const last = groups[groups.length - 1];
    if (last && last.scope === destination.scope) last.items.push(destination);
    else groups.push({ scope: destination.scope, start: index, items: [destination] });
  });
  return groups;
}

/** The live status line: how many results, and how to use them. */
export function destinationSearchStatus(query: string, count: number): string {
  if (!hasSearchWords(query)) return count === 0 ? "" : `${count} ${count === 1 ? "page" : "pages"}, grouped. Use the up and down arrow keys, then Enter to open.`;
  if (count === 0) return "No pages match. Try a different word.";
  return `${count} ${count === 1 ? "result" : "results"}. Use the up and down arrow keys, then Enter to open.`;
}

/** The next active result for a key, wrapping at both ends; `null` for a key that does not move. */
export function nextDestinationIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current <= 0 ? count - 1 : current - 1;
  return null;
}

/** Whether the list is showing: asked open and at least one entry (an empty box lists every destination, #1347). */
export function listExpanded(open: boolean, count: number): boolean {
  return open && count > 0;
}

/** The active index kept inside the results: -1 (none) when there are none or it fell off the end. */
export function clampActiveIndex(active: number, count: number): number {
  if (count <= 0 || active < 0) return -1;
  return active >= count ? count - 1 : active;
}

/** The option the combobox points at (`aria-activedescendant`); undefined while closed or nothing is active. */
export function activeDescendantId(expanded: boolean, active: number, optionId: (index: number) => string): string | undefined {
  return expanded && active >= 0 ? optionId(active) : undefined;
}

export type DestinationKeyAction =
  | { type: "move"; index: number }
  | { type: "choose"; index: number }
  | { type: "close" }
  /** Clears the words and hands focus back (to where it was, else the field or the page, never the body). */
  | { type: "clear" }
  | { type: "restore-focus" }
  | { type: "none" };

/**
 * What a key does in the field. Enter acts only on a showing list (it opens the
 * active result, else the first); Escape closes the list, then clears the words
 * and returns focus, then (nothing left to undo) just returns focus. An IME
 * composition is never acted on.
 */
export function destinationKeyAction(input: {
  key: string;
  composing: boolean;
  open: boolean;
  query: string;
  count: number;
  active: number;
}): DestinationKeyAction {
  if (input.composing) return { type: "none" };
  const expanded = listExpanded(input.open, input.count);
  const active = clampActiveIndex(input.active, input.count);
  switch (input.key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (input.count <= 0) return { type: "none" };
      const next = nextDestinationIndex(expanded ? active : -1, input.count, input.key);
      return next === null ? { type: "none" } : { type: "move", index: next };
    }
    case "Enter": {
      if (!expanded) return { type: "none" };
      // With nothing typed the list is only a menu: Enter opens a page only once an entry is active.
      if (!hasSearchWords(input.query)) return active >= 0 ? { type: "choose", index: active } : { type: "none" };
      return { type: "choose", index: active >= 0 ? active : 0 };
    }
    case "Escape":
      if (expanded) return { type: "close" };
      return input.query !== "" ? { type: "clear" } : { type: "restore-focus" };
    default:
      return { type: "none" };
  }
}

/**
 * Opens a result through the unsaved-changes guard (#647): `guard` runs `go`
 * at once when nothing is dirty, or only after the person confirms. On Cancel
 * nothing runs, so the page, the typed words and the list are untouched.
 */
export function selectDestination(input: {
  destination: Pick<SearchDestination, "href">;
  guard: (navigate: () => void) => boolean | Promise<boolean>;
  reset: () => void;
  navigate: (href: string) => void;
}): boolean | Promise<boolean> {
  return input.guard(() => {
    input.reset();
    input.navigate(input.destination.href);
  });
}

/**
 * How the field treats an action inside the phone More sheet (`escapeBubbles`).
 * An Escape with nothing left to undo is not handled, so it reaches the sheet
 * and closes it, as in the sheet's own "Find a tool" field. Clearing keeps focus
 * in the field there (there is no earlier focus to return to). Outside the sheet
 * every action is handled as is.
 */
export function actionForSurface(
  action: DestinationKeyAction,
  escapeBubbles: boolean,
): { action: DestinationKeyAction; handled: boolean; returnsFocus: boolean } {
  if (action.type === "none") return { action, handled: false, returnsFocus: false };
  if (escapeBubbles && action.type === "restore-focus") return { action: { type: "none" }, handled: false, returnsFocus: false };
  return { action, handled: true, returnsFocus: !escapeBubbles && (action.type === "clear" || action.type === "restore-focus") };
}

/* ---- Records in the header search (#1837): clubs, events, churches and people beside the pages ---- */

/**
 * One row of the combobox, whatever it is: a page or task, a record the server found, or a "See all results" link. The
 * arrow keys, Enter and the one focus ring work over this flat list, so they cross every group.
 */
export type ResultEntry = {
  key: string;
  kind: "page" | "record" | "see-all";
  label: string;
  description: string;
  href: string;
  /** The short word beside the label (the scope, or Club, Event, Church, Person). Never colour alone. */
  badge: string;
  /** What a screen reader hears for the badge. */
  badgeSpoken: string;
  /** The page destination behind a "page" entry. */
  destination?: SearchDestination;
};

export type ResultSection = { id: string; heading: string; start: number; entries: ResultEntry[] };

export const pagesSectionHeading = "Pages and tasks";
export const recordGroupHeadings: Record<RecordGroupKey, string> = { clubs: "Clubs", events: "Events", churches: "Churches", people: "People" };
const recordGroupOrder: readonly RecordGroupKey[] = ["clubs", "events", "churches", "people"];
const recordSingular: Record<RecordGroupKey, string> = { clubs: "club", events: "event", churches: "church", people: "person" };
const recordBadges: Record<RecordGroupKey, { badge: string; spoken: string }> = {
  clubs: { badge: "Club", spoken: "Club" },
  events: { badge: "Event", spoken: "Event" },
  churches: { badge: "Church", spoken: "Church" },
  people: { badge: "Person", spoken: "Person" },
};

export type RecordGroupKey = "clubs" | "events" | "churches" | "people";

/** "Jul 14, 2027" or "Jul 14, 2027 to Jul 17, 2027", in the event's own time zone (UTC if the zone is not valid). */
export function formatEventDates(startsAt: string, endsAt: string, timezone: string): string {
  const format = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  const safe = (iso: string) => {
    try { return format(iso, timezone); } catch { return format(iso, "UTC"); }
  };
  const start = safe(startsAt);
  const end = safe(endsAt);
  return start === end ? start : `${start} to ${end}`;
}

function recordEntries(result: StaffSearchResult): { group: RecordGroupKey; entries: ResultEntry[]; seeAll: ResultEntry | null }[] {
  return recordGroupOrder.map((group) => {
    const source = result[group];
    const { badge, spoken } = recordBadges[group];
    const entries: ResultEntry[] = group === "clubs"
      ? result.clubs.items.map((club) => ({
        key: `club:${club.id}`,
        kind: "record" as const,
        label: club.name,
        description: [club.city, club.sponsoringChurch ? `Sponsored by ${club.sponsoringChurch}` : null, club.isActive ? null : "Inactive"].filter(Boolean).join(" · ") || "Club",
        href: club.href,
        badge,
        badgeSpoken: spoken,
      }))
      : group === "events"
      ? result.events.items.map((event) => ({
        key: `event:${event.id}`,
        kind: "record" as const,
        label: event.name,
        description: formatEventDates(event.startsAt, event.endsAt, event.timezone),
        href: event.href,
        badge,
        badgeSpoken: spoken,
      }))
      : group === "churches"
      ? result.churches.items.map((church) => ({
        key: `church:${church.id}`,
        kind: "record" as const,
        label: church.name,
        description: church.city ?? "Church",
        href: church.href,
        badge,
        badgeSpoken: spoken,
      }))
      : result.people.items.map((person) => ({
        key: `person:${person.id}`,
        kind: "record" as const,
        label: person.name,
        description: person.kind,
        href: person.href,
        badge,
        badgeSpoken: spoken,
      }));
    const seeAll: ResultEntry | null = source.more && source.seeAllHref
      ? { key: `see-all:${group}`, kind: "see-all", label: `See all ${recordSingular[group]} results`, description: "More matches than are listed here.", href: source.seeAllHref, badge: "More", badgeSpoken: "More results" }
      : null;
    return { group, entries, seeAll };
  });
}

/**
 * The combobox's rows and, when they are grouped, its sections. Typed words with records on: Pages and tasks, then
 * Clubs, Events, Churches and People (a group with nothing in it is left out). An empty box: the pages, grouped by scope as
 * before (`groupDestinationsByScope`). Records off (the More sheet): ranked pages, ungrouped, as before.
 */
export function buildResultLayout(input: {
  pages: readonly SearchDestination[];
  hasQuery: boolean;
  /** `null` when records are off; a result (or null while none has arrived) when they are on. */
  records: { enabled: boolean; result: StaffSearchResult | null };
}): { entries: ResultEntry[]; sections: ResultSection[] | null } {
  const pageEntry = (destination: SearchDestination): ResultEntry => ({
    key: destination.key,
    kind: "page",
    label: destination.label,
    description: destination.description,
    href: destination.href,
    badge: destinationScopeLabels[destination.scope],
    badgeSpoken: `Scope: ${destinationScopeDescription(destination.scope)}`,
    destination,
  });
  const pages = input.pages.map(pageEntry);
  if (!input.hasQuery) {
    const sections = groupDestinationsByScope(input.pages).map((group) => ({
      id: `scope-${group.scope}`,
      heading: destinationScopeDescription(group.scope),
      start: group.start,
      entries: pages.slice(group.start, group.start + group.items.length),
    }));
    return { entries: pages, sections };
  }
  if (!input.records.enabled) return { entries: pages, sections: null };

  const sections: ResultSection[] = [];
  const entries: ResultEntry[] = [];
  const push = (id: string, heading: string, rows: ResultEntry[]) => {
    if (rows.length === 0) return;
    sections.push({ id, heading, start: entries.length, entries: rows });
    entries.push(...rows);
  };
  push("pages", pagesSectionHeading, pages);
  if (input.records.result) {
    for (const { group, entries: rows, seeAll } of recordEntries(input.records.result)) push(group, recordGroupHeadings[group], seeAll ? [...rows, seeAll] : rows);
  }
  return { entries, sections };
}

function countWord(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The live status line with records on: counts per group, or that the records are still loading or could not be read. */
export function recordSearchStatus(input: {
  query: string;
  pageCount: number;
  result: StaffSearchResult | null;
  pending: boolean;
  failed: boolean;
}): string {
  const notes = recordMoreNotes(input.result);
  const base = recordSearchStatusBase(input);
  return notes.length > 0 && !input.pending ? `${base} ${notes.join(" ")}` : base;
}

function recordSearchStatusBase(input: {
  query: string;
  pageCount: number;
  result: StaffSearchResult | null;
  pending: boolean;
  failed: boolean;
}): string {
  if (!hasSearchWords(input.query)) return destinationSearchStatus(input.query, input.pageCount);
  const parts: string[] = [];
  if (input.pageCount > 0) parts.push(countWord(input.pageCount, "page", "pages"));
  if (input.result) {
    const { clubs, events, churches, people } = input.result;
    if (clubs.items.length > 0) parts.push(countWord(clubs.items.length, "club", "clubs"));
    if (events.items.length > 0) parts.push(countWord(events.items.length, "event", "events"));
    if (churches.items.length > 0) parts.push(countWord(churches.items.length, "church", "churches"));
    if (people.items.length > 0) parts.push(countWord(people.items.length, "person", "people"));
  }
  const use = "Use the up and down arrow keys, then Enter to open.";
  const failure = input.failed ? " Clubs, events, churches and people could not be searched." : "";
  if (input.pending) return parts.length > 0 ? `${parts.join(", ")} so far. Searching clubs, events, churches and people. ${use}` : "Searching clubs, events, churches and people.";
  if (parts.length === 0) return input.failed ? "Clubs, events, churches and people could not be searched." : "Nothing matches. Try a different word.";
  return `${parts.join(", ")}.${failure} ${use}`.replace("  ", " ");
}

/** The settled answer, only when it is for exactly these words (never rows found for earlier words). */
export function recordAnswerFor<T extends { query: string }>(settled: T, words: string): T | null {
  return settled.query === words ? settled : null;
}

/** A short note per group that has more matches than are listed but no page to see them on. Not a list option. */
export function recordMoreNotes(result: StaffSearchResult | null): string[] {
  if (!result) return [];
  return recordGroupOrder
    .filter((group) => result[group].more && !result[group].seeAllHref)
    .map((group) => `More ${recordGroupHeadings[group].toLowerCase()} match. Type more words to narrow.`);
}

/** Where the active entry (kept by its stable key) sits in the current rows: its new index, or -1 when it is gone or none is active. */
export function activeIndexForKey(entries: readonly ResultEntry[], key: string | null): number {
  return key === null ? -1 : entries.findIndex((entry) => entry.key === key);
}
