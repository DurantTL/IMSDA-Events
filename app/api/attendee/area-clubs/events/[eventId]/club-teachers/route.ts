import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubTeacherApiError } from "@/modules/club-teachers/api-errors";
import { teacherSettingsSchema } from "@/modules/club-teachers/domain";
import { applyTeacherSettings, requireAreaCoordinatorTeacherActor } from "@/modules/club-teachers/settings";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator switches the Club teachers tool on or off for a club event and sets its rule (#1681). Their one
 * write: an active grant, the second sign-in step passed, this one module on club events. Anyone else gets "not found".
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireAreaCoordinatorTeacherActor();
    const { eventId } = await context.params;
    const input = teacherSettingsSchema.parse(await request.json());
    const state = await applyTeacherSettings(actor, eventId, input);
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return clubTeacherApiError(error, "Saving the Club teachers settings");
  }
}

export const PUT = withRequestContext(putHandler);
