import { withRequestContext } from "@/lib/request-context";
import { healthApiError, healthJson } from "@/modules/health-records/api";
import { listSnapshotBreakGlassGrants, requireSnapshotAdminViewer } from "@/modules/health-records/snapshot-access-repository";

/**
 * The break-glass grants on sealed health copies, for the monthly review (#924): who, when, the typed reason, the
 * person id and when it ends. Never a health value. System administrators only, and available with the health
 * records switch off. The listing is audited.
 */
async function getHandler() {
  try {
    const viewer = await requireSnapshotAdminViewer("LIST_BREAK_GLASS", null, { flagOptional: true });
    return healthJson({ grants: await listSnapshotBreakGlassGrants(viewer) });
  } catch (error) {
    return healthApiError(error, "Listing break-glass grants on sealed health copies");
  }
}

export const GET = withRequestContext(getHandler);
