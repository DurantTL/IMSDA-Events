import type { AccountNavItem } from "@/components/account-section-nav";
import { isClubFormsRole } from "@/modules/club-forms/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * The club portal's menu (#644), grouped People / Events / Records / Orders /
 * Club. Every destination keeps the capability check it always had; groups
 * with no visible item simply never appear because the heading is drawn from
 * the items themselves.
 */
export function clubPortalNavItems({
  base,
  role,
  capabilities,
}: {
  base: string;
  role: string;
  capabilities: ClubCapabilities;
}): AccountNavItem[] {
  // Honors, Orders (with supplies on hand) and Class tracking all open on the roster's own gate (#486, #531, #487, #497, #532).
  const roster = capabilities.roster;
  return [
    { href: base, label: "Home" },
    { href: `${base}/roster`, label: "Roster", matchChildren: true, group: "People", hideGroupLabel: true },
    // The honors and class exports live on these two pages (#701); the old reports page redirects to Honors. Their print/export child pages, the roster export and the year-end and month reports keep their parent tab lit (#737).
    ...(roster ? [{ href: `${base}/honors`, label: "Honors", alsoMatchPrefix: `${base}/exports/honors`, group: "People", hideGroupLabel: true }] : []),
    ...(roster ? [{ href: `${base}/class-tracking`, label: "Class tracking", alsoMatchPrefix: `${base}/exports/class-tracking`, group: "People", hideGroupLabel: true }] : []),
    { href: `${base}/events`, label: "Club events", matchChildren: true, group: "Events", hideGroupLabel: true },
    // Club forms (#610) hold health and conduct answers: the club's director and deputy only.
    ...(isClubFormsRole(role) ? [{ href: `${base}/forms`, label: "Forms", matchChildren: true, group: "Events", hideGroupLabel: true }] : []),
    // Event health information (#658): the club's director and deputy, for their own club.
    ...(isClubFormsRole(role) ? [{ href: `${base}/health`, label: "Health", matchChildren: true, group: "Events", hideGroupLabel: true }] : []),
    ...(capabilities.submitReports ? [{ href: `${base}/records`, label: "Monthly Records", matchChildren: true, alsoMatchPrefix: `${base}/reports`, group: "Records", hideGroupLabel: true }] : []),
    // Supplies on hand live inside Orders (#654), so there is no separate Supplies entry.
    ...(roster ? [{ href: `${base}/orders`, label: "Orders", matchChildren: true, group: "Orders", hideGroupLabel: true }] : []),
    ...(capabilities.manageTeam || capabilities.editProfile
      ? [{ href: `${base}/club-info`, label: "Club settings", group: "Club", hideGroupLabel: true }]
      : []),
  ];
}

const SHELL_PRIMARY_ORDER = ["Home", "Roster", "Forms", "Club events"];
const SHELL_MORE_ORDER = ["Honors", "Class tracking", "Monthly Records", "Orders", "Health", "Club settings"];

/**
 * The club shell's navigation (#1165): Home, Roster, Forms and Club events
 * stay in the bar and every other destination the role already has goes under
 * More. This only regroups the items `clubPortalNavItems` or
 * `clubReporterNavItems` already produced, so a role never gains a destination
 * here (no second permission list), and nothing is silently dropped: labels
 * not listed above land at the end of More. Showing or hiding a link is not
 * authorization; each page still checks on the server.
 */
export function clubShellNavigation(items: AccountNavItem[]): { primary: AccountNavItem[]; more: AccountNavItem[] } {
  const rank = (order: string[], label: string) => order.indexOf(label);
  const primary = items
    .filter((item) => rank(SHELL_PRIMARY_ORDER, item.label) >= 0)
    .sort((a, b) => rank(SHELL_PRIMARY_ORDER, a.label) - rank(SHELL_PRIMARY_ORDER, b.label));
  const more = items
    .filter((item) => rank(SHELL_PRIMARY_ORDER, item.label) < 0)
    .sort((a, b) => {
      const ra = rank(SHELL_MORE_ORDER, a.label);
      const rb = rank(SHELL_MORE_ORDER, b.label);
      return (ra < 0 ? SHELL_MORE_ORDER.length : ra) - (rb < 0 ? SHELL_MORE_ORDER.length : rb);
    });
  // A bar that would hold only Home next to a More with one item (a reporter) shows that item directly: a menu of one hides it for nothing.
  if (primary.length === 1 && more.length === 1) return { primary: [...primary, ...more], more: [] };
  return { primary, more };
}

/** A reporter with no roster access (#375, #377): Home and the two report screens only. */
export function clubReporterNavItems({ base, capabilities }: { base: string; capabilities: ClubCapabilities }): AccountNavItem[] {
  return [
    { href: base, label: "Home" },
    ...(capabilities.submitReports ? [{ href: `${base}/records`, label: "Monthly Records", matchChildren: true, alsoMatchPrefix: `${base}/reports`, group: "Records", hideGroupLabel: true }] : []),
  ];
}

/**
 * The Area Coordinator's view of one club (#722): the club portal's menu in
 * its view-only form. It lists only destinations a coordinator can already
 * open (each page still checks access on the server); the director's
 * editing-only screens (Class tracking, Club settings, Health, Monthly Records
 * entry) and Orders (#918) are never listed. Every item stays inside this club: Roster, Events
 * and Monthly Records are sections of the club's Home page (ages only), and
 * the Sterling Volunteers status, counts and note are on its roster.
 *
 * Anchor items (`#open-club-...`) can't show an active state: the nav reads
 * `usePathname`, which has no hash. Monthly Records is active on the report
 * month pages through `alsoMatchPrefix`.
 */
export function areaClubPortalNavItems({ organizationId }: { organizationId: string }): AccountNavItem[] {
  const base = `/account/area/${encodeURIComponent(organizationId)}`;
  return [
    { href: base, label: "Home" },
    { href: `${base}#open-club-roster`, label: "Roster", group: "People", hideGroupLabel: true },
    { href: `${base}/honors`, label: "Honors", group: "People", hideGroupLabel: true },
    { href: `${base}#open-club-events`, label: "Events", group: "Events", hideGroupLabel: true },
    { href: `${base}/forms`, label: "Club forms", matchChildren: true, group: "Events", hideGroupLabel: true },
    { href: `${base}#open-club-reports`, label: "Monthly Records", alsoMatchPrefix: `${base}/reports`, group: "Records", hideGroupLabel: true },
    // No Orders entry (#918): club Orders are not an Area Coordinator's to see, and the server refuses them.
    // Grouped with Records, never under a group named "Orders" (#1187): the menu names no director tool, not even as a hidden heading.
    { href: `${base}/awards`, label: "Earned awards", group: "Records", hideGroupLabel: true },
  ];
}
