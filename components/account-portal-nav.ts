import type { AccountNavItem } from "@/components/account-section-nav";

/**
 * The "Your account" menu (#1175, #1551), as one pure function so each role's tab set can be tested.
 *
 * - The attendee's own tabs come first and in the same order for everyone; a person with no attendee account
 *   (staff acting as a club role) has none of them.
 * - "My club" / "My clubs" is for anyone who directs a club, including a coordinator who also directs one, and for
 *   staff acting as a director. Staff acting as an Area Coordinator direct nothing, so they never get it.
 * - "Club coordination" is the coordinator's single club area: every club is found in Overview > Clubs at a glance,
 *   the view-only club pages (`/account/area/...`) and Waitlists stay lit under it, and Waitlists is one of its tabs,
 *   not a menu item of its own.
 * - Help comes last.
 */
export type AccountPortalNavInput = {
  /** Whether an attendee account is signed in (the chrome account). */
  hasAccount: boolean;
  /** How many clubs the account directs right now. */
  directedClubCount: number;
  /** A real Area Coordinator grant. */
  areaCoordinator: boolean;
  /** A staff member's act-as role, if any. */
  actingRole: "CLUB_DIRECTOR" | "AREA_COORDINATOR" | null;
};

export function accountPortalNavItems(input: AccountPortalNavInput): AccountNavItem[] {
  const actingAsAreaCoordinator = input.actingRole === "AREA_COORDINATOR";
  const actingAsDirector = input.actingRole === "CLUB_DIRECTOR";
  return [
    ...(input.hasAccount
      ? [
        { href: "/account", label: "Overview" },
        { href: "/account/registrations", label: "My registrations" },
        { href: "/account/profile", label: "Profile" },
      ]
      : []),
    ...(!actingAsAreaCoordinator && (input.directedClubCount > 0 || actingAsDirector)
      ? [{ href: "/account/clubs", label: input.directedClubCount === 1 || actingAsDirector ? "My club" : "My clubs", matchChildren: true }]
      : []),
    ...(input.areaCoordinator || actingAsAreaCoordinator
      ? [{ href: "/account/area-clubs/overview", label: "Club coordination", alsoMatchPrefix: ["/account/area-clubs/", "/account/area/", "/account/area/health", "/account/waitlists"] }]
      : []),
    // Portal help (#1259): last, for anyone using the portal. Which guides it lists is decided on its own pages.
    { href: "/account/help", label: "Help", matchChildren: true },
  ];
}

/**
 * What the workspace menu keeps during a staff act-as: a separate attendee cookie must not add personal destinations
 * to it. A director act-as keeps the club and Help; an Area Coordinator act-as keeps Club coordination and Help.
 */
export function workspaceMenuNavItems(items: AccountNavItem[], actingRole: AccountPortalNavInput["actingRole"]): AccountNavItem[] {
  if (!actingRole) return items;
  return items.filter((item) => item.href === "/account/clubs" || item.href === "/account/help"
    || (actingRole === "AREA_COORDINATOR" && item.href === "/account/area-clubs/overview"));
}
