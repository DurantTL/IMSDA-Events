import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { listAreaPauses, setAreaPaused } from "@/modules/system-admin/area-pause";
import { areaPauseKeys } from "@/modules/system-admin/area-pause-model";

/**
 * The per-area pause switches (#1518) are global, so they are gated on the global role directly, like notifications and
 * platform settings. This route is never itself paused: classification only covers visitor and club routes, so an
 * administrator can always turn a pause off.
 */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can pause an area." },
    { status: 403 },
  );
}

const bodySchema = z.object({
  area: z.enum(areaPauseKeys, { message: "That is not an area that can be paused." }),
  paused: z.boolean(),
}).strict();

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  return Response.json({ pauses: await listAreaPauses() });
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = bodySchema.parse(await request.json());
    await setAreaPaused(input.area, input.paused, user.id);
    return Response.json({ pauses: await listAreaPauses() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "INVALID_AREA_PAUSE",
          message: error.issues[0]?.message ?? "Review the request and try again.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400 });
    }
    logError("Updating an area pause failed", error);
    return Response.json(
      { error: "AREA_PAUSE_UPDATE_FAILED", message: "The pause could not be saved." },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);
