import { ContextualHelp } from "@/components/contextual-help";
import { contextualPortalHelp, contextualStaffHelp } from "@/modules/help/contextual";
import { loadPortalHelpViewer } from "@/modules/help/portal-viewer";
import { loadHelpViewer } from "@/modules/help/viewer";

/**
 * Server side of contextual help (#1259): picks the guide for a working page and shows the button only when this
 * viewer may see that guide. Only the guide's static text reaches the browser. Place it on a page, not in a shared header.
 */
export async function StaffContextualHelp({ guideId, event }: { guideId: string; event?: string }) {
  const help = contextualStaffHelp(guideId, await loadHelpViewer(event));
  return help ? <ContextualHelp help={help} /> : null;
}

export async function PortalContextualHelp({ guideId }: { guideId: string }) {
  const help = contextualPortalHelp(guideId, await loadPortalHelpViewer());
  return help ? <ContextualHelp help={help} /> : null;
}
