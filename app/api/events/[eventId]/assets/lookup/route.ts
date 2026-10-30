import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { lookupAsset, searchDeskPeople } from "@/modules/issued-assets/view";
import { parsePageParam } from "@/lib/pagination";
import { withRequestContext } from "@/lib/request-context";

/**
 * Manual lookup for the check-in desk: `?code=K-214` finds an item (by scan code or identifier, the same way issuing
 * does) and who holds it; `?person=smith` finds attendees by name or confirmation code (empty lists them all), paged with `&page=`. Check-in staff.
 */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requireAssetStaff(eventId, "MANAGE_CHECK_IN");
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (code !== null) return assetJson({ asset: await lookupAsset(eventId, code.slice(0, 64)) });
    const person = url.searchParams.get("person");
    if (person !== null) {
      const { items, page, pageCount, total, from, to } = await searchDeskPeople(eventId, person.slice(0, 80), undefined, parsePageParam(url.searchParams.get("page")));
      return assetJson({ people: items, page, pageCount, total, from, to });
    }
    return assetJson({ error: "INVALID_ASSET_INPUT", message: "Give a code or a person to look up." }, 400);
  } catch (error) {
    return assetApiError(error, "The lookup");
  }
}

export const GET = withRequestContext(getHandler);
