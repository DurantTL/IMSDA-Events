import "server-only";

import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { isModuleEnabled } from "@/modules/event-modules/service";
import { findActiveMembership } from "@/modules/events/repository";

export class EmergencyPlanError extends Error {
  constructor(
    message: string,
    public readonly code: "MODULE_DISABLED" | "VERSION_NOT_FOUND" | "EMPTY_PLAN" | "PUBLISH_CONFLICT" | "EVENT_NOT_FOUND",
    public readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "EmergencyPlanError";
  }
}

/**
 * The one server-side gate for every emergency plan route and action: the
 * event permission first (viewing and printing need VIEW_EVENT, editing and
 * publishing CONFIGURE_EVENT), then the per-event module. A module that is
 * off answers 404 and no data is read.
 */
export async function requireEmergencyPlanAccess(eventId: string, permission: "VIEW_EVENT" | "CONFIGURE_EVENT") {
  const access = await requirePermission(await getCurrentSession(), eventId, permission, findActiveMembership);
  if (!(await isModuleEnabled(eventId, "emergency-plans"))) {
    throw new EmergencyPlanError("The emergency plan is not turned on for this event.", "MODULE_DISABLED", 404);
  }
  return access;
}
