import "server-only";

import {
  AccessDeniedError,
  requireAuthenticatedUser,
} from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { isDisclosureAllowed, staffIdentityAudience, type DisclosureAction } from "@/modules/people/disclosure-matrix";

/**
 * Who may merge and unmerge people (#127). Today that is a system
 * administrator, the same cross-event `globalRole` the review queue uses
 * (`requireSystemAdministrator`): `Person` is global, and there is no other
 * global permission system. It is a separate, explicitly named function so a
 * narrower permission (#128) can replace it without touching the review
 * queue's own gate.
 */
export async function requirePersonMergePermission(action: DisclosureAction = "EDIT") {
  const user = requireAuthenticatedUser(await getCurrentSession());
  // The matrix decides (`disclosure-matrix.ts`): merging and unmerging are EDIT
  // of merge history, listing merges is READ; both are global-reach.
  if (!isDisclosureAllowed("MERGE_HISTORY", staffIdentityAudience(user), action)) {
    throw new AccessDeniedError(
      action === "READ"
        ? "System administrator access is required to see merged people."
        : "System administrator access is required to merge or unmerge people.",
      403,
      "PERMISSION_DENIED",
    );
  }
  return user;
}
