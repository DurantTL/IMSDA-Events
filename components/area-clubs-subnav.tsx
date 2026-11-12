import type { AccountNavItem } from "@/components/account-section-nav";
import { ClubPortalNav } from "@/components/club-portal-nav";

/**
 * The coordinator's task navigation (#1186): Overview first, then every
 * destination the Clubs menu (#657) always had, with the same routes. There is
 * no "All clubs" tab (#1551): Overview's Clubs at a glance is the one club list
 * and stays lit for the coordinator's club pages (`/account/area/...`).
 * Waitlists is added only for a real Area Coordinator (#599), never for a staff
 * act-as; the page itself still checks on the server, so a link only mirrors that. TLT directory (#1686) is the same
 * kind of link, for the TLT director only.
 */
export function coordinatorNavItems({ showWaitlists = false, showTlt = false, showMasterGuide = false }: { showWaitlists?: boolean; showTlt?: boolean; showMasterGuide?: boolean } = {}): AccountNavItem[] {
  return [
    { href: "/account/area-clubs/overview", label: "Overview" },
    // The club list owns the view-only club pages, so Clubs stays lit on them (#1759).
    { href: "/account/area-clubs/clubs", label: "Clubs", alsoMatchPrefix: "/account/area/" },
    { href: "/account/area-clubs/reports", label: "Monthly Records", alsoMatchPrefix: "/account/area-clubs/reports/" },
    { href: "/account/area-clubs/points", label: "Points" },
    { href: "/account/area-clubs/events", label: "Club events" },
    { href: "/account/area-clubs/team-permissions", label: "Team approvals" },
    { href: "/account/area-clubs/applications", label: "New clubs" },
    ...(showWaitlists ? [{ href: "/account/waitlists", label: "Waitlists" }] : []),
    // The TLT directory (#1686): only the Area Coordinator the TLT director setting is on for; the pages and routes check on the server.
    ...(showTlt ? [{ href: "/account/area-clubs/tlt", label: "TLT directory", alsoMatchPrefix: "/account/area-clubs/tlt/" }] : []),
    // Master Guide approvals (#1698): for a real Area Coordinator, once any club uses the optional feature; the page checks on the server.
    ...(showMasterGuide ? [{ href: "/account/area-clubs/master-guide", label: "Master Guide approvals" }] : []),
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
