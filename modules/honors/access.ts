import "server-only";

import { AccessDeniedError, requireAuthenticatedUser, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import type { EventPermission } from "@/modules/access/permissions";
import { findActiveMembership } from "@/modules/events/repository";

/** Honors Weekend setup is event configuration: CONFIGURE_EVENT on that site. */
export async function requireHonorPermission(eventId: string, permission: EventPermission = "CONFIGURE_EVENT") {
  return requirePermission(await getCurrentSession(), eventId, permission, findActiveMembership);
}

/**
 * Placing a youth in a full class by hand, or removing a pick after class changes closed (#962) is for system administrators
 * only. Not an event role, not Event Admin, not a director or staff acting as one, and not a permission an event can grant:
 * it is the global role, so nothing at the event level reaches it.
 */
export async function requireSeatOverrideAdministrator() {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (user.globalRole !== "SYSTEM_ADMIN") {
    throw new AccessDeniedError(
      "Only a system administrator can place a youth in a full class or remove a class pick by hand.",
      403,
      "PERMISSION_DENIED",
    );
  }
  return user;
}
