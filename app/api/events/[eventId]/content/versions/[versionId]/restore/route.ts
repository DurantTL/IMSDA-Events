import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { sanitizedHtmlBySection } from "@/modules/events/content-html";
import { EventContentError } from "@/modules/events/content-repository";
import { PageVersionRestoreError, restoreEventPageVersion } from "@/modules/events/page-restore";
import { findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string; versionId: string }> };

/** Restores an earlier published version of the event page (#1514). The ordinary save checks all apply. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, versionId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
    const restored = await restoreEventPageVersion({
      eventId,
      versionId,
      actorUserId: access.user.id,
      isSystemAdmin: access.user.globalRole === "SYSTEM_ADMIN",
    });
    return Response.json({
      versionNumber: restored.versionNumber,
      sections: restored.sections,
      sanitizedHtml: sanitizedHtmlBySection(restored.sections),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof PageVersionRestoreError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.code === "VERSION_NOT_FOUND" ? 404 : 409 },
      );
    }
    if (error instanceof EventContentError) {
      return Response.json({ error: error.code, message: error.message }, { status: 403 });
    }
    logError("Restoring an event page version failed", error);
    return Response.json(
      { error: "EVENT_PAGE_RESTORE_FAILED", message: "The version could not be restored." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
