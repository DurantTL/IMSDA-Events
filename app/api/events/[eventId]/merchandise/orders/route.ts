import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { listMerchandiseOrders, requireMerchandiseOrderAccess } from "@/modules/merchandise/order-list";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

/** Staff-only and read-only: merchandise orders for this event. Needs configuration access plus registration or finance access. */
async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requireMerchandiseOrderAccess(await getCurrentSession(), eventId);
    return Response.json(await listMerchandiseOrders(eventId));
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    return Response.json({ error: "MERCHANDISE_ORDERS_FAILED", message: "The merchandise orders could not be loaded." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
