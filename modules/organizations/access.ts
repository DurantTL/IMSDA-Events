import "server-only";

import {
  AccessDeniedError,
  requireAuthenticatedUser,
} from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";

export async function requireSystemAdministrator(
  deniedMessage = "System administrator access is required to manage clubs and churches.",
) {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (user.globalRole !== "SYSTEM_ADMIN") {
    throw new AccessDeniedError(
      deniedMessage,
      403,
      "PERMISSION_DENIED",
    );
  }
  return user;
}
