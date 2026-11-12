import { eventAssetResponse } from "@/modules/events/asset-response";
import { authorizeImageLibrary, imageLibraryApiError } from "@/modules/events/image-library-http";
import { findLibraryImageFile } from "@/modules/events/image-library";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string; imageId: string }> };

/** Staff-only preview of a library image. Same headers as an event file. */
async function getHandler(request: Request, context: RouteContext) {
  try {
    const { eventId, imageId } = await context.params;
    await authorizeImageLibrary(eventId);
    const image = await findLibraryImageFile(imageId);
    if (!image) {
      return Response.json(
        { error: "IMAGE_NOT_FOUND", message: "That image is no longer in the library." },
        { status: 404 },
      );
    }
    const disposition = new URL(request.url).searchParams.get("disposition") === "inline" ? "inline" : "attachment";
    return eventAssetResponse(image, disposition);
  } catch (error) {
    return imageLibraryApiError(error, "Opening the library image");
  }
}

export const GET = withRequestContext(getHandler);
