import { withCurrentEvent } from "@/components/staff-navigation";
import type { EventPermission } from "@/modules/access/permissions";
import { findGuide, helpDestinations, helpGuides } from "@/modules/help/guides";
import type { HelpGuide } from "@/modules/help/types";

/**
 * Who may see which guide (#1077). Decided on the server, from data the shell
 * already has. A guide that is not visible is never listed, searched or opened,
 * and asking for it by id answers exactly like an id that does not exist.
 * Nothing here grants access: every page a guide points to checks for itself.
 */
export type HelpViewer = {
  isSystemAdmin: boolean;
  /** The selected event, or "" when there is none (a staff account with no event). */
  selectedEventId: string;
  /** The viewer's permissions for the selected event. */
  permissions: readonly EventPermission[];
};

/** The one line shown where a link is not available. It never names the hidden page. */
export const askAdministratorText = "Ask an administrator for this event if you need this.";

/** The same line when no event is selected, so it does not mention an event that is not there. */
export const askSystemAdministratorText = "Ask a system administrator if you need this.";

/** The line for a page the viewer cannot open. */
export function unavailableText(viewer: Pick<HelpViewer, "selectedEventId">): string {
  return viewer.selectedEventId ? askAdministratorText : askSystemAdministratorText;
}

export function canSeeGuide(guide: Pick<HelpGuide, "audience">, viewer: HelpViewer): boolean {
  switch (guide.audience.kind) {
    case "everyone": return true;
    case "system": return viewer.isSystemAdmin;
    case "event-permission": return viewer.isSystemAdmin || viewer.permissions.includes(guide.audience.permission);
  }
}

export function visibleGuides(viewer: HelpViewer): HelpGuide[] {
  return helpGuides.filter((guide) => canSeeGuide(guide, viewer));
}

/** The guide for an id, only when this viewer may see it. Unknown and hidden look the same: `undefined`. */
export function guideForViewer(id: string, viewer: HelpViewer): HelpGuide | undefined {
  const guide = findGuide(id);
  return guide && canSeeGuide(guide, viewer) ? guide : undefined;
}

export type GuideLink = { id: string; label: string; href: string };

/**
 * The working pages of a guide the viewer can open, with the event added, and
 * how many were left out. System pages need a system administrator; event pages
 * need a selected event and the permission the page needs (system administrators
 * hold every one). A left-out page is only counted, never named.
 */
export function guideLinksForViewer(guide: HelpGuide, viewer: HelpViewer): { links: GuideLink[]; unavailable: number } {
  const links: GuideLink[] = [];
  let unavailable = 0;
  for (const id of guide.destinationIds) {
    const destination = helpDestinations[id];
    if (!destination) continue;
    const allowed = destination.scope === "System"
      ? viewer.isSystemAdmin
      : Boolean(viewer.selectedEventId)
        && (viewer.isSystemAdmin || !destination.permission || viewer.permissions.includes(destination.permission));
    if (allowed) links.push({ id, label: destination.label, href: withCurrentEvent(destination.path, viewer.selectedEventId) });
    else unavailable += 1;
  }
  return { links, unavailable };
}

export { filterGuides } from "@/modules/help/guide-filter";

/** The hub's workspace filter: every guide, or only System administration or Event workspace guides. */
export type WorkspaceFilter = "all" | "System" | "Event";

export const workspaceFilterLabels: Record<WorkspaceFilter, string> = {
  all: "All",
  System: "System administration",
  Event: "Event workspace",
};

/**
 * The filter choices this viewer is offered. System appears only when they have a System guide, so staff who
 * cannot open System guides never see a choice that would always be empty (and never learn they exist).
 */
export function workspaceFilterOptions(guides: readonly Pick<HelpGuide, "workspace">[]): WorkspaceFilter[] {
  return guides.some((guide) => guide.workspace === "System") ? ["all", "System", "Event"] : ["all", "Event"];
}

export function filterGuidesByWorkspace<T extends Pick<HelpGuide, "workspace">>(guides: readonly T[], filter: WorkspaceFilter): T[] {
  return filter === "all" ? [...guides] : guides.filter((guide) => guide.workspace === filter);
}
