import "server-only";

import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { requireSystemAdministrator } from "@/modules/organizations/access";

export const questionLibraryManageDeniedMessage = "System administrator access is required to rename, edit or delete saved questions.";
export const questionLibraryBuildDeniedMessage = "Form-building access is required to use the question library.";

/**
 * Who may save to and add from the library (#1070): anyone who can build forms. A system administrator always can; event
 * staff need MANAGE_FORMS on the event they are building for (`eventId`). With no event only a system administrator is let in,
 * which is the case for the general information-form builder.
 */
export async function requireQuestionLibraryBuilder(eventId: string | null | undefined) {
  if (eventId) {
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FORMS", findActiveMembership);
    return { userId: access.user.id, eventId };
  }
  const admin = await requireSystemAdministrator(questionLibraryBuildDeniedMessage);
  return { userId: admin.id, eventId: null };
}

/** Who may rename, edit or delete a saved question: system administrators only, whatever form-building permissions they hold elsewhere. */
export async function requireQuestionLibraryManager() {
  const admin = await requireSystemAdministrator(questionLibraryManageDeniedMessage);
  return { userId: admin.id, eventId: null };
}
