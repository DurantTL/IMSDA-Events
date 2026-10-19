import "server-only";

import { createHash } from "node:crypto";
import { canonicalState, type RegistrationStateSnapshot } from "@/modules/cancellation-requests/domain";

/** A hash of the registration facts a request was calculated from, so staff can see at a glance whether they changed. */
export function stateFingerprint(state: RegistrationStateSnapshot) {
  return createHash("sha256").update(canonicalState(state)).digest("hex");
}
