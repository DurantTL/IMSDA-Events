import "server-only";

import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import type { InformationFormAuthorization } from "@/modules/information-forms/api";

/** GENERAL forms belong to no event, so only a system administrator manages them. */
export async function authorizeGeneralInformationForms(): Promise<InformationFormAuthorization> {
  const admin = await requireSystemAdministrator("System administrator access is required to manage general information forms.");
  return { userId: admin.id, target: { scope: "GENERAL" } };
}

/** EVENT forms: a system administrator, or event staff holding MANAGE_FORMS on that event (the existing permission). */
export async function authorizeEventInformationForms(params: { eventId: string }): Promise<InformationFormAuthorization> {
  const access = await requirePermission(await getCurrentSession(), params.eventId, "MANAGE_FORMS", findActiveMembership);
  return { userId: access.user.id, target: { scope: "EVENT", eventId: params.eventId } };
}
