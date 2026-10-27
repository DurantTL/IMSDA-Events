import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { listActiveEventPermissionsForUser } from "@/modules/access/membership-repository";
import { eventPermissions } from "@/modules/access/permissions";
import { selectEventContext } from "@/modules/events/context-selection";
import { readLastUsedEventId } from "@/modules/events/last-used-event";
import { listEventsForUser } from "@/modules/events/repository";
import type { HelpViewer } from "@/modules/help/visibility";

/**
 * The viewer for the Help pages (#1077), read the way the workspace shell reads it:
 * the same event choice and the same permissions, so a page and the sidebar agree.
 * Unlike an event page it never redirects for event selection, because staff with
 * no event may open Help. A visitor without a staff session goes to the staff login.
 */
export const loadHelpViewer = cache(async (requestedEventId?: string): Promise<HelpViewer> => {
  const user = (await getCurrentSession()).user;
  if (!user) redirect(await staffLoginRedirectPath());
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  const events = await listEventsForUser(user.id, isSystemAdmin, { archived: "include" });
  const selection = selectEventContext({
    events,
    requestedEventId,
    lastUsedEventId: requestedEventId ? null : await readLastUsedEventId(),
  });
  const event = selection.kind === "picker" || selection.kind === "unavailable" ? null : selection.event;
  if (!event) return { isSystemAdmin, selectedEventId: "", permissions: [] };
  const permissions = isSystemAdmin
    ? [...eventPermissions]
    : (await listActiveEventPermissionsForUser(user.id, [event.id])).get(event.id) ?? [];
  return { isSystemAdmin, selectedEventId: event.id, permissions };
});
