import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { healthApiError, healthJson, readHealthJson } from "@/modules/health-records/api";
import { liftSnapshotHold, requireSnapshotAdminViewer } from "@/modules/health-records/snapshot-access-repository";

type RouteContext = { params: Promise<{ holdId: string }> };

const bodySchema = z.object({ reason: z.string().max(2000) }).strict();

/** Lifts a legal hold on sealed health copies, with a reason. System administrators only. Audited. Works with the health records switch off. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { holdId } = await context.params;
    const viewer = await requireSnapshotAdminViewer("LIFT_HOLD", holdId, { flagOptional: true });
    const body = bodySchema.parse(await readHealthJson(request));
    return healthJson({ ok: true, ...(await liftSnapshotHold(viewer, holdId, body.reason)) });
  } catch (error) {
    return healthApiError(error, "Lifting a legal hold on sealed health copies");
  }
}

export const POST = withRequestContext(postHandler);
