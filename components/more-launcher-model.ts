import {
  moreDirectoryGroupLabels,
  moreDirectoryGroupOrder,
  type MoreDirectoryCard,
  type MoreDirectoryGroup,
} from "@/components/staff-navigation";

/**
 * The More launcher's pure rules (#741 slice 2): which cards it lists, how they
 * group, the footer links, arrow-key movement, and where focus goes on close.
 * Kept free of React so each rule is testable on its own. The launcher only
 * lists destinations; every page and route keeps its own authorization.
 */

export type LauncherGroup = { group: MoreDirectoryGroup; label: string; cards: readonly MoreDirectoryCard[] };

/** Allowed cards only, in the directory's group order. A group with no allowed card is left out. */
export function launcherGroups(cards: readonly MoreDirectoryCard[]): LauncherGroup[] {
  return moreDirectoryGroupOrder
    .map((group) => ({
      group,
      label: moreDirectoryGroupLabels[group],
      cards: cards.filter((card) => card.allowed && card.group === group),
    }))
    .filter((entry) => entry.cards.length > 0);
}

const pathOfHref = (href: string) => href.split(/[?#]/)[0];

/**
 * The desktop popover leaves out a card whose destination is already a sidebar
 * item this viewer sees (#967), so nothing is listed twice. `sidebarHrefs` is
 * the set of sidebar hrefs actually drawn for the viewer, so a card the sidebar
 * does not show for them stays. The phone sheet has no sidebar and passes
 * nothing, so it keeps every card.
 */
export function omitSidebarDuplicates(cards: readonly MoreDirectoryCard[], sidebarHrefs: ReadonlySet<string> | undefined): readonly MoreDirectoryCard[] {
  if (!sidebarHrefs || sidebarHrefs.size === 0) return cards;
  const paths = new Set([...sidebarHrefs].map(pathOfHref));
  return cards.filter((card) => !paths.has(pathOfHref(card.href)));
}

/**
 * The same rule for footer links (#967): the desktop popover drops a footer
 * link whose path is already a sidebar item the viewer sees, whichever change
 * added either one. Without `sidebarHrefs` (the phone sheet) every link stays.
 */
export function omitSidebarFooterLinks<T extends { href: string }>(links: readonly T[], sidebarHrefs: ReadonlySet<string> | undefined): T[] {
  if (!sidebarHrefs || sidebarHrefs.size === 0) return [...links];
  const paths = new Set([...sidebarHrefs].map(pathOfHref));
  return links.filter((link) => !paths.has(pathOfHref(link.href)));
}

/**
 * Cards matching a typed search (#967): every word must appear, in any order,
 * in the card's title or short description, ignoring case. A blank query keeps
 * every card. It only narrows what the viewer may already see; it never adds.
 */
export function filterLauncherCards(cards: readonly MoreDirectoryCard[], query: string): readonly MoreDirectoryCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return cards;
  return cards.filter((card) => {
    const text = `${card.title} ${card.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** What Enter opens: the first allowed match in the order the launcher draws (group by group), or null. */
export function firstLauncherMatch(cards: readonly MoreDirectoryCard[]): MoreDirectoryCard | null {
  return launcherGroups(cards)[0]?.cards[0] ?? null;
}

/** Text for the search's live status line, or an empty string while nothing is typed. */
export function launcherSearchStatus(query: string, count: number): string {
  if (query.trim() === "") return "";
  if (count === 0) return "No tool matches. Clear the search to see them all.";
  return `${count} ${count === 1 ? "match" : "matches"}. Press Enter to open the first.`;
}

/**
 * Module requests exist (#741 slice 3): Event Admins get a "Request a feature"
 * link. The flag stays so a deployment-wide switch-off is one line.
 */
export const moduleRequestsEnabled = true;

export type LauncherFooterLink = { key: "manage-modules" | "event-modules" | "request-feature"; label: string; href: string };

/**
 * Everyone gets a link to the Event modules page, which also holds the audit
 * trail: system administrators as "Manage event modules", everyone else as "Event
 * modules and activity". Event staff also get "Request a feature" when requests
 * exist and the viewer may make one; with the flag off nobody does. Only Event Admins (`CONFIGURE_EVENT`) who are not system administrators can.
 */
export function launcherFooterLinks({
  isSystemAdmin,
  canRequestFeature = false,
  requestsEnabled = moduleRequestsEnabled,
  eventQuery,
}: {
  isSystemAdmin: boolean;
  canRequestFeature?: boolean;
  requestsEnabled?: boolean;
  eventQuery: string;
}): LauncherFooterLink[] {
  if (isSystemAdmin) return [{ key: "manage-modules", label: "Manage event modules", href: `/more${eventQuery}` }];
  const links: LauncherFooterLink[] = [{ key: "event-modules", label: "Event modules and activity", href: `/more${eventQuery}` }];
  if (requestsEnabled && canRequestFeature) {
    links.push({ key: "request-feature", label: "Request a feature", href: `/more${eventQuery}#request-a-feature` });
  }
  return links;
}

/**
 * Arrow-key movement through the launcher's links in reading order (the two
 * columns read top to bottom, then across, so the DOM order is the visual
 * order). Wraps at both ends; Home and End jump. `null` means the key is not one
 * the launcher handles.
 */
export function nextLauncherIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export type LauncherCloseReason = "escape" | "toggle" | "outside" | "navigate";

/**
 * Whether closing the launcher puts focus back on its trigger. Escape and the
 * trigger itself do. A click elsewhere, following a link, or tabbing out leaves
 * focus where the person put it, so the launcher never pulls it back.
 */
export function returnsFocusToTrigger(reason: LauncherCloseReason): boolean {
  return reason === "escape" || reason === "toggle";
}

/** Plain left-clicks open the launcher; a modified click (new tab, new window) keeps the link's normal behavior. */
export function isPlainClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The width at which the phone tab bar and sheet give way to the sidebar and
 * popover. Matches the stylesheet's `@media (max-width: 800px)` phone block: the
 * sheet closes when this starts matching.
 */
export const phoneMaxWidthPx = 800;
export const desktopBreakpointQuery = `(min-width: ${phoneMaxWidthPx + 1}px)`;

/**
 * Where the directory was left (#741 slice 4): the card last opened, the page it
 * opened and how far the list was scrolled. It is used only when the person is
 * back on that page or one of its children; anywhere else the launcher opens at
 * the first card, scrolled to the top. Kept in memory for the life of the staff
 * shell (which persists across client navigations), keyed by user and event so a
 * shared tab never carries one person's position to another, and cleared on
 * Escape and on sign-out.
 */
export type LauncherPosition = {
  userId: string;
  eventQuery: string;
  cardKey: string | null;
  /** The opened card's href; its path decides whether the memory still applies. */
  href: string;
  scrollTop: number;
};

let rememberedPosition: LauncherPosition | null = null;

export function rememberLauncherPosition(position: LauncherPosition): void {
  rememberedPosition = position;
}

const pathOf = (href: string) => href.split(/[?#]/)[0];

export function recallLauncherPosition({ userId, eventQuery, pathname }: { userId: string; eventQuery: string; pathname: string }): LauncherPosition | null {
  const remembered = rememberedPosition;
  if (!remembered || remembered.userId !== userId || remembered.eventQuery !== eventQuery) return null;
  const target = pathOf(remembered.href);
  return pathname === target || pathname.startsWith(`${target}/`) ? remembered : null;
}

export function forgetLauncherPosition(): void {
  rememberedPosition = null;
}
