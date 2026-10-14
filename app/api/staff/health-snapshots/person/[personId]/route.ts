import { withRequestContext } from "@/lib/request-context";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthApiError, healthDisabledResponse, healthJson } from "@/modules/health-records/api";
import { viewSealedSnapshots } from "@/modules/health-records/snapshot-access-repository";

type RouteContext = { params: Promise<{ personId: string }> };

/**
 * Opens a person's sealed health copies (#924). A system administrator with an unexpired break-glass grant
 * for this person, after the privacy acknowledgment; nobody else. The view is audited with ids and counts
 * before any value is decrypted.
 */
async function getHandler(_request: Request, context: RouteContext) {
  const disabled = healthDisabledResponse();
  if (disabled) return disabled;
  try {
    const { personId } = await context.params;
    const viewer = await requireStaffHealthViewer();
    return healthJson(await viewSealedSnapshots(viewer, personId));
  } catch (error) {
    return healthApiError(error, "Opening sealed health copies");
  }
}

export const GET = withRequestContext(getHandler);
