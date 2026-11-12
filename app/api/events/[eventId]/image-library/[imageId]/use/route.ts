import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { listEventAssets } from "@/modules/events/asset-repository";
import { authorizeImageLibrary, imageLibraryApiError } from "@/modules/events/image-library-http";
import { applyLibraryImageToEvent } from "@/modules/events/image-library";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string; imageId: string }> };

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, imageId } = await context.params;
    const access = await authorizeImageLibrary(eventId);
    const used = await applyLibraryImageToEvent(eventId, imageId, access.user.id);
    const assets = await listEventAssets(eventId);
    return Response.json(
      { asset: assets.find((asset) => asset.id === used.assetId) ?? null, assets, reused: used.reused },
      { status: used.reused ? 200 : 201 },
    );
  } catch (error) {
    return imageLibraryApiError(error, "Using the library image");
  }
}

export const POST = withRequestContext(postHandler);
