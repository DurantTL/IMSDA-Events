import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthApiError, healthDisabledResponse, healthJson, readHealthJson } from "@/modules/health-records/api";
import { startSnapshotBreakGlass } from "@/modules/health-records/snapshot-access-repository";

const bodySchema = z.object({ personId: z.string().min(1).max(64), reason: z.string().max(2000) }).strict();

/**
 * Break-glass for a person's sealed health copies (#924): a system administrator types a reason and
 * gets 24 hours. Anyone else is refused (audited). With the feature switched off it answers like an unknown route.
 */
async function postHandler(request: Request) {
  const disabled = healthDisabledResponse();
  if (disabled) return disabled;
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const body = bodySchema.parse(await readHealthJson(request));
    const viewer = await requireStaffHealthViewer();
    const grant = await startSnapshotBreakGlass(viewer, { personId: body.personId, reason: body.reason });
    return healthJson({ ok: true, grantId: grant.grantId, expiresAt: grant.expiresAt.toISOString(), snapshotCount: grant.snapshotCount });
  } catch (error) {
    return healthApiError(error, "Starting break-glass access to sealed health copies");
  }
}

export const POST = withRequestContext(postHandler);
