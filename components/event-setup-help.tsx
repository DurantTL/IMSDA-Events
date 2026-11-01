"use client";

import { RoleSetupHelp } from "@/components/role-setup-help";
import { useStaffViewer } from "@/components/staff-viewer-context";
import { findGuide } from "@/modules/help/guides";
import { canSeeGuide, type HelpViewer } from "@/modules/help/visibility";
import { eventSetupFor, type EventSetupId } from "@/modules/setup-help/event-setup-steps";

/**
 * Setup help for an event admin or other event staff in the Event workspace (#1435, round B). The shell's viewer decides
 * what is offered: a Set up link to another page only when the viewer's permission opens it, who to ask when they cannot
 * act, and a Help guide link only when the viewer may open that guide (an unseen guide answers like a missing page, so it
 * is never linked). The staff guide link carries the event, like every Help link. `viewer` overrides the shell's (tests).
 */
export function EventSetupHelp({ id, context, viewer, systemAdmin, setupKey, sameAs, eventId }: { id: EventSetupId; context?: string; viewer?: HelpViewer | null; systemAdmin?: boolean; setupKey?: string; sameAs?: string; /** The page's own event (a server page passes it). It wins over the shell's selection, which is only the fallback for client workspaces. */ eventId?: string }) {
  const shellViewer = useStaffViewer();
  const who = viewer === undefined ? shellViewer : viewer;
  const pageEventId = eventId || who?.selectedEventId || "";
  const entry = eventSetupFor(id, {
    eventId: pageEventId || null,
    can: who ? (permission) => who.isSystemAdmin || who.permissions.includes(permission) : undefined,
    systemAdmin: systemAdmin ?? who?.isSystemAdmin ?? false,
  });
  const guide = entry.guideId ? findGuide(entry.guideId) : undefined;
  const visible = Boolean(who && guide && canSeeGuide(guide, who));
  const query = pageEventId ? `?event=${encodeURIComponent(pageEventId)}` : "";
  return <RoleSetupHelp context={context} entry={entry} sameAs={sameAs} setupKey={setupKey} guideHref={visible ? `/help/${entry.guideId}${query}` : null} />;
}
