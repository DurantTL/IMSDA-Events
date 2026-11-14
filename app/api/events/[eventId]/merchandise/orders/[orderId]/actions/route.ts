import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { EventClosedError } from "@/modules/events/money-lock";
import { applyMerchandiseOrderAction, MerchandiseOrderActionError } from "@/modules/merchandise/order-actions";
import { merchandiseOrderActionSchema } from "@/modules/merchandise/order-actions-domain";
import { requireMerchandiseOrderAccess } from "@/modules/merchandise/order-list";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string; orderId: string }> };

/**
 * Staff actions on one merchandise order (#148): mark paid (cash, check or a Square card payment taken elsewhere),
 * comp, cancel. Never calls Square and never moves money. Viewing orders needs configuration plus registration or
 * finance access; Mark paid and Comp also need finance access; Cancel needs only the viewing access.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, orderId } = await context.params;
    const session = await getCurrentSession();
    const access = await requireMerchandiseOrderAccess(session, eventId);
    const input = merchandiseOrderActionSchema.parse(await request.json());
    if (input.action !== "CANCEL") await requirePermission(session, eventId, "MANAGE_FINANCE", findActiveMembership);
    const result = await applyMerchandiseOrderAction(eventId, orderId, access.user.id, input);
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_ORDER_ACTION", message: error.issues[0]?.message ?? "Check the form and try again.", issues: error.issues }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "INVALID_ORDER_ACTION", message: "Check the form and try again." }, { status: 400 });
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof EventClosedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof MerchandiseOrderActionError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Unable to apply merchandise order action", error);
    return Response.json({ error: "MERCHANDISE_ORDER_ACTION_FAILED", message: "The order could not be changed." }, { status: 500 });
  }
}

export const POST = withRequestContext(postHandler);
