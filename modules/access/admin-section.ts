import "server-only";

import { cache } from "react";
import { resolveAdminRoleView } from "@/modules/access/admin-roles";
import type { AuthenticatedUser } from "@/modules/access/authorization";
import { adminSectionFor, type AdminSection } from "@/components/admin-section-nav";

const roleViewFor = cache((userId: string, globalRole: string) =>
  resolveAdminRoleView({ id: userId, globalRole: globalRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : null }));

/**
 * Which section header a page shows for this viewer (#1274), from the roles held now and the role view the switcher is
 * showing (`currentAdminRoleView`). Only the view changes which header shows; each page keeps its own access check.
 * `eventId` is the event an event page shows: the Events header only draws for an event the viewer administers.
 */
export async function activeAdminSection(
  user: Pick<AuthenticatedUser, "id" | "globalRole">,
  pathname: string,
  eventId?: string | null,
): Promise<AdminSection | null> {
  const { roles, active } = await roleViewFor(user.id, user.globalRole ?? "");
  return adminSectionFor(pathname, {
    active,
    systemAdmin: roles.systemAdmin,
    administersEvent: Boolean(eventId) && roles.eventAdminEventIds.includes(eventId as string),
  });
}
