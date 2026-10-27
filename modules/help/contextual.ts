import { withCurrentEvent } from "@/components/staff-navigation";
import type { HelpViewer } from "@/modules/help/visibility";
import { guideForViewer } from "@/modules/help/visibility";
import type { PortalHelpViewer } from "@/modules/help/portal-visibility";
import { portalGuideForViewer } from "@/modules/help/portal-visibility";

/**
 * Contextual help (#1259): the static text of one guide, handed to the client dialog on a working page. It holds
 * only the guide's own words and a link to the full guide: no event, attendee, club or person data.
 */
export type ContextualHelpData = {
  guideId: string;
  title: string;
  summary: string;
  steps: readonly string[];
  /** The full guide, opened in a new tab so the working page and its unsaved edits stay. */
  fullHref: string;
};

/** The staff guide for a working page, only when this viewer may see it. Otherwise `null`: no button is shown. */
export function contextualStaffHelp(guideId: string, viewer: HelpViewer): ContextualHelpData | null {
  const guide = guideForViewer(guideId, viewer);
  if (!guide) return null;
  return { guideId: guide.id, title: guide.title, summary: guide.summary, steps: guide.steps, fullHref: withCurrentEvent(`/help/${guide.id}`, viewer.selectedEventId) };
}

/** The portal guide for a working page, only when this viewer may see it. */
export function contextualPortalHelp(guideId: string, viewer: PortalHelpViewer): ContextualHelpData | null {
  const guide = portalGuideForViewer(guideId, viewer);
  if (!guide) return null;
  return { guideId: guide.id, title: guide.title, summary: guide.summary, steps: guide.steps, fullHref: `/account/help/${guide.id}` };
}
