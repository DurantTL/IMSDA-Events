import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { withRequestContext } from "@/lib/request-context";
import { approveAndOpenCatalogSales, closeCatalogSales, MerchandiseCatalogApprovalError } from "@/modules/merchandise/catalog-approval";
import { getMerchandiseCatalog } from "@/modules/merchandise/catalog-repository";

type Context = { params: Promise<{ eventId: string }> };

/** Approving and closing merchandise sales is for system administrators only,
 * so this does not use the event CONFIGURE_EVENT permission. POST approves and
 * opens sales; DELETE closes them. */
async function handle(request: Request, context: Context, action: "approve" | "close") {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { user } = await getCurrentSession();
    if (!user) return Response.json({ error: "AUTHENTICATION_REQUIRED", message: "Authentication is required." }, { status: 401 });
    if (user.globalRole !== "SYSTEM_ADMIN") {
      return Response.json({ error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can approve or close merchandise sales." }, { status: 403 });
    }
    const { eventId } = await context.params;
    const event = await getPrisma().event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) return Response.json({ error: "EVENT_NOT_FOUND", message: "That event no longer exists." }, { status: 404 });
    if (action === "approve") await approveAndOpenCatalogSales(eventId, user.id);
    else await closeCatalogSales(eventId, user.id);
    return Response.json(await getMerchandiseCatalog(eventId));
  } catch (error) {
    if (error instanceof MerchandiseCatalogApprovalError) return Response.json({ error: error.code, message: error.message }, { status: 409 });
    logError("merchandise.catalog_approval_failed", error);
    return Response.json({ error: "MERCHANDISE_APPROVAL_FAILED", message: "The merchandise approval request could not be completed." }, { status: 500 });
  }
}

export const POST = withRequestContext((request: Request, context: Context) => handle(request, context, "approve"));
export const DELETE = withRequestContext((request: Request, context: Context) => handle(request, context, "close"));
