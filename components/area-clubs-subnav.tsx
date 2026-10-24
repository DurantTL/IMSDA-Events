import { AccountSectionNav, type AccountNavItem } from "@/components/account-section-nav";

/**
 * The coordinator's task navigation (#1186): Overview first, then every
 * destination the Clubs menu (#657) always had, with the same routes. "All
 * clubs" stays lit for the coordinator's club pages (`/account/area/...`).
 * Waitlists is added only for a real Area Coordinator (#599), never for a staff
 * act-as; the page itself still checks on the server, so a link only mirrors that.
 */
export function coordinatorNavItems({ showWaitlists = false }: { showWaitlists?: boolean } = {}): AccountNavItem[] {
  return [
    { href: "/account/area-clubs/overview", label: "Overview" },
    { href: "/account/clubs", label: "All clubs", matchChildren: true, alsoMatchPrefix: "/account/area/" },
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
 * The Area Coordinator's Clubs menu (#657). The tab row sits in the same
 * 1180px column as the hero and the page body (#722). On a phone the row
 * scrolls sideways, with the scroll arrows and edge fades as the cue and the
 * current tab kept in view.
 */
export function AreaClubsSubNav({ items = areaClubsNavItems }: { items?: AccountNavItem[] }) {
  return (
    <div className="account-page-body account-page-subnav">
      <AccountSectionNav items={items} label="Club coordination" variant="secondary" />
    </div>
  );
}
