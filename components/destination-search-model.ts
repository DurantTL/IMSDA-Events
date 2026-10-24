import {
  buildMoreDirectoryCards,
  eventFeaturesItem,
  matchesVisibility,
  navigation,
  sidebarSections,
  withCurrentEvent,
  type NavigationItem,
} from "@/components/staff-navigation";
import { systemNavGroups } from "@/components/system-navigation";
import type { EventPermission } from "@/modules/access/permissions";

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
export type DestinationScope = "System" | "Event" | "Profile";

export type SearchDestination = {
  /** Stable per scope and path, used as the option id and React key. */
  key: string;
  scope: DestinationScope;
  label: string;
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
};

/** What each scope means, for the label beside a result. */
export const destinationScopeLabels: Record<DestinationScope, string> = {
  System: "System",
  Event: "Event",
  Profile: "Profile",
};

/** The text a screen reader hears for a result's scope. */
export function destinationScopeDescription(scope: DestinationScope): string {
  switch (scope) {
    case "System": return "System administration";
    case "Event": return "The selected event";
    case "Profile": return "Your account";
  }
}

const pathOf = (href: string) => href.split("?")[0].split("#")[0];

/** Task words by destination path (no query string). Words people use that the label does not. */
const destinationKeywords: Record<string, readonly string[]> = {
  "/event-setup": ["new event", "add event", "start event", "build event"],
  "/admin/calendar": ["calendar", "conference calendar", "public calendar", "calendar item", "visitors"],
  "/event-setup/copy": ["copy event", "duplicate event", "clone event", "last year", "previous event", "rollover"],
  "/admin/event-templates": ["template", "starting point", "new event"],
  "/archived-events": ["archive", "finished events", "old events", "past events", "put away"],
  "/admin/organizations": ["church", "churches", "club directory", "organizations", "directors"],
  "/admin/clubs/reports": ["monthly record", "club reports"],
  "/admin/clubs/summary": ["club overview", "club health"],
  "/admin/clubs/applications": ["invite club", "new club", "club invite", "application"],
  "/admin/clubs/transfers": ["move member", "transfer member"],
  "/admin/team": ["invite staff", "add staff", "staff access", "permissions", "roles", "who can"],
  "/admin/accounts": ["sign in", "login", "password", "user accounts"],
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
  "/admin/settings": ["platform", "configuration", "preferences", "options", "sign-in settings", "payment settings"],
  "/admin/readiness": ["ready", "checklist", "go live", "launch"],
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

/**
 * Every destination this viewer may open, in menu order: System, then Event,
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
      hiddenCardKeys: context.hiddenCardKeys,
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
  const keywordWords = wordsOf(destination.keywords.join(" "));
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
  return destinations
    .map((destination, index) => ({ destination, index, score: scoreDestination(destination, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.destination);
}

/** The live status line: how many results, and how to use them. Empty while nothing is typed. */
export function destinationSearchStatus(query: string, count: number): string {
  if (query.trim() === "") return "";
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

/** Whether the list is showing: asked open, something typed, and at least one result. */
export function listExpanded(open: boolean, query: string, count: number): boolean {
  return open && query.trim() !== "" && count > 0;
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
  const expanded = listExpanded(input.open, input.query, input.count);
  const active = clampActiveIndex(input.active, input.count);
  switch (input.key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (input.count <= 0 || input.query.trim() === "") return { type: "none" };
      const next = nextDestinationIndex(expanded ? active : -1, input.count, input.key);
      return next === null ? { type: "none" } : { type: "move", index: next };
    }
    case "Enter":
      return expanded ? { type: "choose", index: active >= 0 ? active : 0 } : { type: "none" };
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
  guard: (navigate: () => void) => boolean;
  reset: () => void;
  navigate: (href: string) => void;
}): boolean {
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
