import "server-only";

import {
  AccessDeniedError,
  requireAuthenticatedUser,
} from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { isDisclosureAllowed, staffIdentityAudience } from "@/modules/people/disclosure-matrix";

/**
 * `Person` is a global, cross-event entity, and the match review queue is
 * "minimum disclosure": it must not become a route to identity data for
 * people a reviewer would not otherwise be able to see. There is no
 * per-event permission that fits (no single `EventPermission` governs a
 * cross-event comparison of two people), so this mirrors
 * `modules/organizations/access.ts` and gates on the same cross-event
 * `globalRole` used by `modules/system-admin`. The decision is the
 * disclosure matrix's (`disclosure-matrix.ts`): a global read of match
 * candidate evidence, which only the system administrator audience holds.
 */
export async function requireSystemAdministrator() {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (!isDisclosureAllowed("MATCH_CANDIDATE_EVIDENCE", staffIdentityAudience(user), "READ")) {
    throw new AccessDeniedError(
      "System administrator access is required to review possible duplicate people.",
      403,
      "PERMISSION_DENIED",
    );
  }
  return user;
}
