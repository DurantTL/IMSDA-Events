import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { beaconBodySchema, beaconMaxBytes, optedOutByHeaders } from "@/modules/public-metrics/domain";
import { recordPublicMetric } from "@/modules/public-metrics/repository";

/**
 * The first-party beacon for public analytics (#111). It reads no session or cookie, keeps no address, device or
 * identifier, and logs nothing about the request. A visitor who signals Global Privacy Control or Do Not Track is not
 * counted. It answers 204 whether the hit was counted or dropped (an unknown, private or unpublished event, a value
 * outside the allowlists, a bad body), so the response says nothing about which events exist.
 */
const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  if (optedOutByHeaders(request.headers)) return noContent();
  try {
    // Refuse a large body before reading it, as the registration routes do.
    if (Number(request.headers.get("content-length") ?? 0) > beaconMaxBytes) return noContent();
    const text = await request.text();
    if (text.length > beaconMaxBytes) return noContent();
    const parsed = beaconBodySchema.safeParse(JSON.parse(text));
    if (parsed.success) await recordPublicMetric(parsed.data.metric, parsed.data.dimension ?? "");
  } catch {
    // A malformed body is dropped like any other bad hit.
  }
  return noContent();
}

export const POST = withRequestContext(postHandler);
