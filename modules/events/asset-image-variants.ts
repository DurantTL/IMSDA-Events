import "server-only";

import { readAsset } from "@/modules/events/asset-storage";
import { contentDisposition, eventAssetResponse } from "@/modules/events/asset-response";
import { isResizableContentType, parseVariantWidth } from "@/modules/events/asset-variant-widths";

type StoredAsset = { displayName: string; contentType: string; storageKey: string };

/**
 * The asset, resized to a phone- or desktop-sized webp when `?w=` asks for an allowed width (#1207). Everything else,
 * including a non-raster file, a width not on the list, or an image sharp cannot read, is the original response.
 */
export async function eventAssetVariantResponse(asset: StoredAsset, widthParam: string | null) {
  const width = parseVariantWidth(widthParam);
  if (!width || !isResizableContentType(asset.contentType)) return eventAssetResponse(asset);

  let resized: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    resized = await sharp(await readAsset(asset.storageKey))
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return eventAssetResponse(asset);
  }

  return new Response(new Uint8Array(resized), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(resized.byteLength),
      "Content-Disposition": contentDisposition("attachment", asset.displayName.replace(/\.[^./]+$/, "") + ".webp"),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}
