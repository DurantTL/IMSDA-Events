/**
 * Admin roles and the role switcher (#1225). Pure helpers, safe to import from
 * client components and unit tests.
 *
 * Three admin roles exist on a staff account:
 * - SYSTEM_ADMIN: `GlobalRole.SYSTEM_ADMIN`.
 * - CLUBS_ADMIN: an active `ClubsAdministratorGrant`, given by a system administrator.
 * - EVENTS_ADMIN: not a stored role. Anyone with an active EVENT_ADMIN membership
 *   on one or more events, scoped to those events only.
 *
 * The switcher only changes the view. Server gates never read its cookie.
 */

export const ADMIN_ROLES = ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_COOKIE_NAME = "imsda_admin_role";

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  EVENTS_ADMIN: "Events Administrator",
  CLUBS_ADMIN: "Clubs Administrator",
  SYSTEM_ADMIN: "System Administrator",
};

export type AdminRoles = {
  systemAdmin: boolean;
  clubsAdministrator: boolean;
  eventAdminEventIds: readonly string[];
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/** The roles held, in switcher order (Events, Clubs, System). */
export function heldAdminRoles(roles: AdminRoles): AdminRole[] {
  const held: AdminRole[] = [];
  if (roles.eventAdminEventIds.length > 0) held.push("EVENTS_ADMIN");
  if (roles.clubsAdministrator) held.push("CLUBS_ADMIN");
  if (roles.systemAdmin) held.push("SYSTEM_ADMIN");
  return held;
}

/**
 * The role whose view is showing: the cookie's choice when the person still
 * holds it, otherwise the broadest role held (System, then Clubs, then Events),
 * or null when they hold none. A stale or forged cookie value is ignored.
 */
export function resolveActiveAdminRole(held: readonly AdminRole[], cookieValue: string | null | undefined): AdminRole | null {
  if (held.length === 0) return null;
  if (isAdminRole(cookieValue) && held.includes(cookieValue)) return cookieValue;
  if (held.includes("SYSTEM_ADMIN")) return "SYSTEM_ADMIN";
  if (held.includes("CLUBS_ADMIN")) return "CLUBS_ADMIN";
  return "EVENTS_ADMIN";
}

/** Where a role's workspace starts: System management, the Clubs summary, the Events Administrator dashboard, or (no role) the event workspace. */
export function adminRoleLanding(role: AdminRole | null): string {
  if (role === "CLUBS_ADMIN") return "/admin/clubs";
  if (role === "SYSTEM_ADMIN") return "/admin";
  if (role === "EVENTS_ADMIN") return "/events-admin";
  return "/overview";
}

/** The note beside the pills. Nothing to say when only one role is held. */
export function adminRoleSwitchNote(held: readonly AdminRole[]): string | null {
  return held.length > 1 ? `You hold ${held.length} admin roles. Switch between them any time.` : null;
}

export type AdminRoleCounts = Partial<Record<AdminRole, number>>;

/** The sidebar a role's view shows: the club areas for Clubs, the event workspace for Events, everything as before for System. */
export function adminRoleSidebarKind(active: AdminRole | null): "clubs" | "events" | "default" {
  if (active === "CLUBS_ADMIN") return "clubs";
  if (active === "EVENTS_ADMIN") return "events";
  return "default";
}

