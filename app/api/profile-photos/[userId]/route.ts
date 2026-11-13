import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentSession } from "@/modules/access/current-session";
import { eventAssetResponse } from "@/modules/events/asset-response";
import { findProfilePhotoFile, removeProfilePhotoByStaff } from "@/modules/profile-photos/repository";
import { canViewProfilePhoto } from "@/modules/profile-photos/viewing";

type RouteContext = { params: Promise<{ userId: string }> };

function notFound() {
  return Response.json({ error: "PHOTO_NOT_FOUND", message: "There is no photo here." }, { status: 404 });
}

/**
 * A staff member's photo, for signed-in staff who may see that person (#1640). Someone who may not see the person gets
 * the same answer as a person with no photo, so the route does not reveal who has one. There is no public URL.
 */
async function getHandler(request: Request, context: RouteContext) {
  try {
    const { user } = await getCurrentSession();
    if (!user) return Response.json({ error: "UNAUTHENTICATED", message: "Sign in to see photos." }, { status: 401 });
    const { userId } = await context.params;
    if (!(await canViewProfilePhoto(user, userId))) return notFound();
    const size = new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
    const storageKey = await findProfilePhotoFile(userId, size);
    if (!storageKey) return notFound();
    const response = await eventAssetResponse(
      { displayName: "profile-photo.webp", contentType: "image/webp", storageKey },
      "inline",
    );
    // The page URL carries `v=<uploadedAt>`, so a replacement is a new URL; the answer is only for this browser.
    response.headers.set("Cache-Control", "private, max-age=3600");
    return response;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return notFound();
    logError("Opening a profile photo failed.", error);
    return Response.json({ error: "PHOTO_READ_FAILED", message: "The photo could not be opened." }, { status: 500 });
  }
}

/** A system administrator removes an inappropriate photo. The action is logged and the person is told. */
async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { user } = await getCurrentSession();
    if (!user) return Response.json({ error: "UNAUTHENTICATED", message: "Sign in first." }, { status: 401 });
    if (user.globalRole !== "SYSTEM_ADMIN") {
      return Response.json({ error: "FORBIDDEN", message: "Only a system administrator can remove someone else's photo." }, { status: 403 });
    }
    const { userId } = await context.params;
    const removed = await removeProfilePhotoByStaff(userId, user.id);
    if (!removed) return notFound();
    return Response.json({ removed: true });
  } catch (error) {
    logError("Removing a profile photo failed.", error);
    return Response.json({ error: "PHOTO_REMOVE_FAILED", message: "The photo could not be removed. Please try again." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
export const DELETE = withRequestContext(deleteHandler);
