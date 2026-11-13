import { eventAssetVariantResponse } from "@/modules/events/asset-image-variants";
import { findPreviewEventAsset, findPreviewLinkByToken } from "@/modules/events/preview-link-repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ token: string; assetId: string }> };

/**
 * A file or picture on an event page preview (#1514), reached only through a working preview link. It serves a file the
 * event's own sections use, published or not, and nothing else. The same plain answer for every miss: a wrong or ended
 * link, another event's file, or a file no section uses.
 */
async function getHandler(request: Request, context: RouteContext) {
  try {
    const { token, assetId } = await context.params;
    const link = await findPreviewLinkByToken(token);
    const asset = link ? await findPreviewEventAsset(link.eventId, assetId) : null;
    if (!asset) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const response = await eventAssetVariantResponse(asset, new URL(request.url).searchParams.get("w"));
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    logError("Serving an event page preview file failed", error);
    return new Response("Unavailable", { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
