import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { authorizeImageLibrary, imageLibraryApiError, libraryViewer } from "@/modules/events/image-library-http";
import {
  getLibraryImageRecord,
  ImageLibraryError,
  setLibraryImageRetired,
  updateLibraryImageTags,
} from "@/modules/events/image-library";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string; imageId: string }> };

/** Body: `{ tags?: string[], retired?: boolean }`. */
async function patchHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, imageId } = await context.params;
    const access = await authorizeImageLibrary(eventId);
    const body = await request.json().catch(() => null) as { tags?: unknown; retired?: unknown } | null;
    if (!body || typeof body !== "object" || (body.tags === undefined && body.retired === undefined)) {
      return Response.json({ error: "INVALID_REQUEST", message: "Send tags or retired." }, { status: 400 });
    }
    if (body.retired !== undefined && typeof body.retired !== "boolean") {
      return Response.json({ error: "INVALID_REQUEST", message: "Retired must be true or false." }, { status: 400 });
    }
    if (body.tags !== undefined) await updateLibraryImageTags(eventId, imageId, body.tags, access.user.id);
    if (typeof body.retired === "boolean") await setLibraryImageRetired(eventId, imageId, body.retired, access.user.id);
    const image = await getLibraryImageRecord(eventId, imageId, libraryViewer(access));
    if (!image) throw new ImageLibraryError("IMAGE_NOT_FOUND", "That image is no longer in the library.");
    return Response.json({ image });
  } catch (error) {
    return imageLibraryApiError(error, "Updating the library image");
  }
}

export const PATCH = withRequestContext(patchHandler);
