import "server-only";

import { cookies } from "next/headers";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import {
  ADMIN_ROLE_COOKIE_NAME,
  adminRoleLanding,
  heldAdminRoles,
  isAdminRole,
  resolveActiveAdminRole,
  type AdminRole,
  type AdminRoles,
} from "@/modules/access/admin-roles-domain";

type RolesClient = Prisma.TransactionClient | PrismaClient;

/**
 * Whether this staff user holds an active Clubs Administrator grant (#1225).
 * Reads the database on every call, with no caching, so a revoke takes effect
 * on the next request.
 */
export async function isActiveClubsAdministrator(userId: string, client: RolesClient = getPrisma()): Promise<boolean> {
  const grant = await client.clubsAdministratorGrant.findFirst({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  return Boolean(grant);
}

/** Every admin role a staff user holds: the one place roles are resolved on the server. */
export async function resolveAdminRoles(
  user: Pick<AuthenticatedUser, "id" | "globalRole">,
  client: RolesClient = getPrisma(),
): Promise<AdminRoles> {
  const [clubsAdministrator, memberships] = await Promise.all([
    isActiveClubsAdministrator(user.id, client),
    client.eventMembership.findMany({
      where: { userId: user.id, status: "ACTIVE", role: "EVENT_ADMIN" },
      select: { eventId: true },
    }),
  ]);
  return {
    systemAdmin: user.globalRole === "SYSTEM_ADMIN",
    clubsAdministrator,
    eventAdminEventIds: memberships.map((membership) => membership.eventId),
  };
}

/**
 * The role the switcher is showing. The cookie is only a view preference: it is
 * checked against the roles held on every request and ignored when not held.
 */
export async function currentAdminRoleView(roles: AdminRoles): Promise<{ held: AdminRole[]; active: AdminRole | null }> {
  const held = heldAdminRoles(roles);
  let value: string | undefined;
  try {
    value = (await cookies()).get(ADMIN_ROLE_COOKIE_NAME)?.value;
  } catch {
    value = undefined;
  }
  return { held, active: resolveActiveAdminRole(held, value) };
}

/** System administrator or an active Clubs Administrator: the page-level form of `requireClubsAdministration`. */
export async function hasClubsAdministration(user: Pick<AuthenticatedUser, "id" | "globalRole">): Promise<boolean> {
  return user.globalRole === "SYSTEM_ADMIN" || isActiveClubsAdministrator(user.id);
}

/** The roles held and the one showing, for the shell and the home landing. */
export async function resolveAdminRoleView(user: Pick<AuthenticatedUser, "id" | "globalRole">) {
  const roles = await resolveAdminRoles(user);
  return { roles, ...(await currentAdminRoleView(roles)) };
}

/**
 * Switches which held admin role is showing (#1225) and returns that role's
 * home. The choice is remembered for this browser session only (an httpOnly
 * session cookie, no max age). It changes the view and nothing else: no server
 * gate reads the cookie, and a role the person does not hold (or an unknown
 * value) is ignored, so the view stays where it was.
 */
export async function switchAdminRoleView(user: Pick<AuthenticatedUser, "id" | "globalRole">, requested: unknown): Promise<string> {
  const { held, active } = await resolveAdminRoleView(user);
  if (!isAdminRole(requested) || !held.includes(requested)) return adminRoleLanding(active);
  (await cookies()).set(ADMIN_ROLE_COOKIE_NAME, requested, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return adminRoleLanding(requested);
}
