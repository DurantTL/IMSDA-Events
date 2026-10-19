import { z } from "zod";
import { logError } from "@/lib/logger";
import { isLockTimeoutError, isSerializationFailure } from "@/lib/prisma-errors";
import { withRequestContext } from "@/lib/request-context";
import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import type { EventPermission } from "@/modules/access/permissions";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { MealError, mealErrorStatus } from "@/modules/meals/errors";

const noStore = { "Cache-Control": "no-store" };

export function mealApiError(error: unknown, action: string) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_MEAL_INPUT", message: error.issues[0]?.message ?? "Review the details.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  }
  if (error instanceof MealError) {
    return Response.json({ error: error.code, message: error.message }, { status: mealErrorStatus(error.code), headers: noStore });
  }
  if (isLockTimeoutError(error) || isSerializationFailure(error)) {
    return Response.json({ error: "MEAL_BUSY", message: "Another change landed at the same time. Nothing was saved. Refresh and try again." }, { status: 409, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "MEAL_REQUEST_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}

type Context<P> = { params: Promise<{ eventId: string } & P> };

/**
 * A meal route: the same-origin check on every mutation, the event's permission checked on the server from the URL's
 * event (never from the body), and one error shape. `permission` is what the verb needs: services need
 * CONFIGURE_EVENT; plans, prices, orders and anything that moves money need MANAGE_FINANCE.
 */
export function mealRoute<P extends Record<string, string> = Record<never, never>>(
  permission: EventPermission | readonly EventPermission[],
  action: string,
  work: (input: { request: Request; eventId: string; userId: string; params: { eventId: string } & P }) => Promise<Response>,
  options: { mutates?: boolean } = {},
) {
  return withRequestContext(async (request: Request, context: Context<P>) => {
    if (options.mutates !== false) {
      const originError = rejectCrossOriginRequest(request);
      if (originError) return originError;
    }
    try {
      const params = await context.params;
      const session = await getCurrentSession();
      // A list means any one of them opens the route; the last refusal is the one reported.
      const options = Array.isArray(permission) ? permission as readonly EventPermission[] : [permission as EventPermission];
      let access: Awaited<ReturnType<typeof requirePermission>> | null = null;
      for (const [index, candidate] of options.entries()) {
        try {
          access = await requirePermission(session, params.eventId, candidate, findActiveMembership);
          break;
        } catch (error) {
          if (!(error instanceof AccessDeniedError) || error.code !== "PERMISSION_DENIED" || index === options.length - 1) throw error;
        }
      }
      if (!access) throw new AccessDeniedError("A permission is required for this event.", 403, "PERMISSION_DENIED");
      return await work({ request, eventId: params.eventId, userId: access.user.id, params });
    } catch (error) {
      return mealApiError(error, action);
    }
  });
}

export const jsonOk = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
