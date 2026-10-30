import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { searchResponsibleOrganizations } from "@/modules/billing-responsibility/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { parsePageParam } from "@/lib/pagination";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * Picker search for linking a registration to its responsible organization (#165). MANAGE_FINANCE
 * on the event only; matches name only and returns name, type and city, paged on the server (an empty
 * query lists organizations by name, ten at a time).
 */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const { items, page, pageCount, total, from, to } = await searchResponsibleOrganizations(query, parsePageParam(url.searchParams.get("page")));
    return Response.json({ organizations: items, page, pageCount, total, from, to }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Unable to search organizations for billing", error);
    return Response.json({ error: "ORGANIZATION_SEARCH_FAILED" }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
