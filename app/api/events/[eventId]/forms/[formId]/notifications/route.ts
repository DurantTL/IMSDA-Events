import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { FormNotificationError, getFormNotificationsPanel, replaceFormNotifications } from "@/modules/registration-form-notifications/repository";

type RouteContext = { params: Promise<{ eventId: string; formId: string }> };

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function apiError(error: unknown) {
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof FormNotificationError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "FORM_NOT_FOUND" ? 404 : 400 });
  }
  logError("Registration form notifications request failed", error);
  return Response.json({ error: "FORM_NOTIFICATIONS_FAILED", message: "The notifications could not be saved. Try again." }, { status: 500 });
}

/**
 * A form's notifications (#1081). Event administrators and system administrators only (CONFIGURE_EVENT; a system
 * administrator passes every event check), because the list decides who is emailed registration details.
 */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId, formId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    return Response.json(await getFormNotificationsPanel(eventId, formId), { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}

async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, formId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    const body = await request.json().catch(() => null);
    return Response.json(await replaceFormNotifications(eventId, formId, access.user.id, body), { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
