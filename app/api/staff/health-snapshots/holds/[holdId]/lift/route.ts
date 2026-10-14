import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthApiError, healthDisabledResponse, healthJson, readHealthJson } from "@/modules/health-records/api";
import { liftSnapshotHold } from "@/modules/health-records/snapshot-access-repository";

type RouteContext = { params: Promise<{ holdId: string }> };

const bodySchema = z.object({ reason: z.string().max(2000) }).strict();

/** Lifts a legal hold on sealed health copies, with a reason. System administrators only. Audited. */
async function postHandler(request: Request, context: RouteContext) {
  const disabled = healthDisabledResponse();
  if (disabled) return disabled;
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { holdId } = await context.params;
    const body = bodySchema.parse(await readHealthJson(request));
    const viewer = await requireStaffHealthViewer();
    return healthJson({ ok: true, ...(await liftSnapshotHold(viewer, holdId, body.reason)) });
  } catch (error) {
    return healthApiError(error, "Lifting a legal hold on sealed health copies");
  }
}

export const POST = withRequestContext(postHandler);
