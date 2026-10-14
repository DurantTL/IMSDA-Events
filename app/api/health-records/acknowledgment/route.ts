import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { recordHealthPrivacyAcknowledgment } from "@/modules/health-records/acknowledgment";
import { HEALTH_PRIVACY_ACK_VERSION } from "@/modules/health-records/acknowledgment-domain";
import { resolveAcknowledgmentViewer } from "@/modules/health-records/access";
import { healthApiError, healthDisabledResponse, healthJson, readHealthJson } from "@/modules/health-records/api";

/** `version` must be the wording the person was shown; a stale page cannot acknowledge newer wording. */
const bodySchema = z.object({
  as: z.enum(["STAFF", "ATTENDEE"]),
  version: z.literal(HEALTH_PRIVACY_ACK_VERSION, { error: "The notice has changed. Reload the page and read it again." }),
}).strict();

/**
 * Records the signed-in person's one-time privacy acknowledgment (#923). With
 * the feature switched off it answers like an unknown route.
 */
async function postHandler(request: Request) {
  const disabled = healthDisabledResponse();
  if (disabled) return disabled;
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const body = bodySchema.parse(await readHealthJson(request));
    const viewer = await resolveAcknowledgmentViewer(body.as);
    const result = await recordHealthPrivacyAcknowledgment(viewer);
    return healthJson({ ok: true, version: result.version });
  } catch (error) {
    return healthApiError(error, "Recording the privacy acknowledgment");
  }
}

export const POST = withRequestContext(postHandler);
