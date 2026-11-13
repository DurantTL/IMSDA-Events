import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { listPageVersions } from "@/modules/events/page-versions";
import { findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string }> };

/** The latest published versions of the event page (#1514): number, time, who, source, section count and titles. */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    return Response.json({ versions: await listPageVersions(eventId) });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    logError("Loading the event page versions failed", error);
    return Response.json(
      { error: "EVENT_PAGE_VERSIONS_FAILED", message: "The published versions could not be loaded." },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
