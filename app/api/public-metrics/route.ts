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

/** Reads the body but stops as soon as it passes `max` bytes (null then), so a missing content-length cannot force a large read. */
async function readBounded(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  if (optedOutByHeaders(request.headers)) return noContent();
  try {
    // Refuse a large body before reading it, as the registration routes do.
    if (Number(request.headers.get("content-length") ?? 0) > beaconMaxBytes) return noContent();
    const text = await readBounded(request, beaconMaxBytes);
    if (text === null) return noContent();
    const parsed = beaconBodySchema.safeParse(JSON.parse(text));
    if (parsed.success) await recordPublicMetric(parsed.data.metric, parsed.data.dimension ?? "");
  } catch {
    // A malformed body is dropped like any other bad hit.
  }
  return noContent();
}

export const POST = withRequestContext(postHandler);
