import "server-only";

import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { ImageLibraryError, type LibraryViewer } from "@/modules/events/image-library";
import { logError } from "@/lib/logger";

/** Shared by the image-library routes: every one needs CONFIGURE_EVENT on the event. */
export async function authorizeImageLibrary(eventId: string) {
  return requirePermission(await getCurrentSession(), eventId, "CONFIGURE_EVENT", findActiveMembership);
}

export function imageLibraryApiError(error: unknown, operation: string) {
  if (error instanceof ImageLibraryError) {
    const status = error.code === "IMAGE_TOO_LARGE"
      ? 413
      : error.code === "IMAGE_NOT_FOUND"
        ? 404
        : error.code === "IMAGE_RETIRED"
          ? 409
          : 400;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  logError(`${operation} failed`, error);
  return Response.json(
    { error: "IMAGE_LIBRARY_FAILED", message: `${operation} could not be completed.` },
    { status: 500 },
  );
}

/** Which events' titles this viewer may see in "where it is used": the ones they can configure (system admins: all). */
export function libraryViewer(access: Awaited<ReturnType<typeof authorizeImageLibrary>>): LibraryViewer {
  return {
    canConfigureEvent: async (eventId) => {
      if (access.user.globalRole === "SYSTEM_ADMIN") return true;
      const membership = await findActiveMembership(access.user.id, eventId);
      return membership?.status === "ACTIVE" && effectivePermissions(access.user, membership).includes("CONFIGURE_EVENT");
    },
  };
}
