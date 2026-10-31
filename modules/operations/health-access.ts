import "server-only";

import { getServerEnv } from "@/lib/env";
import { getCurrentSessionPassive } from "@/modules/access/current-session";
import { isAuthorizedSweepRequest } from "@/modules/communications/outbox-sweep";
import { isAuthorizedHostJobRequest } from "@/modules/operations/host-job-heartbeat";

/**
 * Who may read the detailed `/api/health` answer (#1400). Everyone else gets the
 * minimal public one (status, time, database).
 */

/**
 * Pure and cheap: the sweep token, or the separate monitor token. The monitor
 * token exists so a third-party uptime service never holds the sweep token. It
 * fails closed when unset or shorter than 32 characters.
 */
export function hasHealthDetailToken(request: Request): boolean {
  try {
    if (isAuthorizedSweepRequest(request)) return true;
    return isAuthorizedHostJobRequest(request, getServerEnv().HEALTH_MONITOR_TOKEN);
  } catch {
    // An unreadable environment must not break the health check; it just reads as "no token".
    return false;
  }
}

/** A signed-in system administrator. Reads the session passively, so a polling monitor tab never keeps it alive. Never throws: any failure reads as "not authorized". */
export async function isSystemAdministratorSession(): Promise<boolean> {
  try {
    const session = await getCurrentSessionPassive();
    return session.user?.globalRole === "SYSTEM_ADMIN";
  } catch {
    return false;
  }
}
