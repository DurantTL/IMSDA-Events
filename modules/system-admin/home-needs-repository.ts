import "server-only";

import { logError } from "@/lib/logger";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import { countWaitingNewClubApplications } from "@/modules/club-applications/repository";
import { buildEventsAdminHome } from "@/modules/events/events-admin-home-model";
import { getEventsAdminEventSources } from "@/modules/events/events-admin-home-repository";
import { loadMetrics } from "@/modules/system-admin/admin-hubs-repository";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";
import type { NeedsInput } from "@/modules/system-admin/home-needs-model";

/** Runs one read; a failure is logged and becomes `null`, which the model shows as "Unavailable" and never as nothing waiting. */
async function attempt<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logError(`Home needs-you read could not load: ${label}`, error);
    return null;
  }
}

/**
 * What the Needs you page reads for the roles a person holds (#1568). Each role reuses the read behind its role pill in the
 * shell: the Events Administrator dashboard's read (whose open balances and draft registrations are what
 * `countEventsAdminWaiting` counts), `countWaitingNewClubApplications` and `getAdminAttentionSummary`, plus the late
 * Monthly Records number of the Clubs hub. Only roles held are read; `roles` comes from `resolveAdminRoles` on the server.
 * Read-only.
 */
export async function loadNeedsInput(roles: AdminRoles, held: NeedsInput["held"], now = new Date()): Promise<NeedsInput> {
  const has = (role: NeedsInput["held"][number]) => held.includes(role);
  const [events, applications, lateRecords, attention] = await Promise.all([
    has("EVENTS_ADMIN")
      ? attempt("events", async () => buildEventsAdminHome(await getEventsAdminEventSources(roles.eventAdminEventIds, now), now))
      : null,
    has("CLUBS_ADMIN")
      ? attempt("club applications", () => countWaitingNewClubApplications(roles.systemAdmin ? "SYSTEM_ADMIN" : "CLUBS_ADMIN"))
      : null,
    has("CLUBS_ADMIN")
      ? loadMetrics(["lateRecords"], { isSystemAdmin: roles.systemAdmin, clubsAdmin: true, siteContentEditor: false }, "home", now).then((values) => values.lateRecords ?? null)
      : null,
    has("SYSTEM_ADMIN") ? attempt("attention", () => getAdminAttentionSummary(now.getTime())) : null,
  ]);
  return { held, events, clubs: { applications, lateRecords }, attention };
}
