import type { AccountNavItem } from "@/components/account-section-nav";
import { ClubPortalNav } from "@/components/club-portal-nav";

/**
 * The coordinator's task navigation (#1186): Overview first, then every
 * destination the Clubs menu (#657) always had, with the same routes. There is
 * no "All clubs" tab (#1551): Overview's Clubs at a glance is the one club list
 * and stays lit for the coordinator's club pages (`/account/area/...`).
 * Waitlists is added only for a real Area Coordinator (#599), never for a staff
 * act-as; the page itself still checks on the server, so a link only mirrors that.
 */
export function coordinatorNavItems({ showWaitlists = false }: { showWaitlists?: boolean } = {}): AccountNavItem[] {
  return [
    // Overview owns the club list (Clubs at a glance, #1551), so it stays lit on the view-only club pages.
    { href: "/account/area-clubs/overview", label: "Overview", alsoMatchPrefix: "/account/area/" },
    { href: "/account/area-clubs/reports", label: "Monthly Records" },
    { href: "/account/area-clubs/points", label: "Points" },
    { href: "/account/area-clubs/events", label: "Club events" },
    { href: "/account/area-clubs/team-permissions", label: "Team approvals" },
    { href: "/account/area-clubs/applications", label: "New clubs" },
    ...(showWaitlists ? [{ href: "/account/waitlists", label: "Waitlists" }] : []),
  ];
}

export const areaClubsNavItems: AccountNavItem[] = coordinatorNavItems();

/**
 * The Area Coordinator's task tabs (#657, #1555): the club portal's own tab strip (`ClubPortalNav`), so both portals
 * look the same: a full-width white row, left-aligned, a purple underline on the current tab. When the row does not fit
 * (below 1024px, or too many tabs) it becomes the menu line with a "Coordinator menu" button (#1641); it never scrolls
 * sideways. Active matching (`alsoMatchPrefix`) is the shared one.
 */
export function AreaClubsSubNav({ items = areaClubsNavItems }: { items?: AccountNavItem[] }) {
  return <ClubPortalNav items={items} label="Club coordination" menuLabel="Coordinator menu" />;
}
