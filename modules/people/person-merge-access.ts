import "server-only";

import {
  AccessDeniedError,
  requireAuthenticatedUser,
} from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";

/**
 * Who may merge and unmerge people (#127). Today that is a system
 * administrator, the same cross-event `globalRole` the review queue uses
 * (`requireSystemAdministrator`): `Person` is global, and there is no other
 * global permission system. It is a separate, explicitly named function so a
 * narrower permission (#128) can replace it without touching the review
 * queue's own gate.
 */
export async function requirePersonMergePermission() {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (user.globalRole !== "SYSTEM_ADMIN") {
    throw new AccessDeniedError(
      "System administrator access is required to merge or unmerge people.",
      403,
      "PERMISSION_DENIED",
    );
  }
  return user;
}
