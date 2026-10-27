import "server-only";

import { readAsset } from "@/modules/events/asset-storage";
import { contentDisposition, eventAssetResponse } from "@/modules/events/asset-response";
import { isResizableContentType, parseVariantWidth } from "@/modules/events/asset-variant-widths";

type StoredAsset = { displayName: string; contentType: string; storageKey: string };

/** A map bounded by entry count and total bytes; the least recently used entry goes first. */
export class ByteLruCache {
  private readonly map = new Map<string, Buffer>();
  private bytes = 0;
  constructor(private readonly maxBytes: number, private readonly maxEntries: number) {}
  get(key: string) {
    const value = this.map.get(key);
    if (!value) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key: string, value: Buffer) {
    if (value.byteLength > this.maxBytes) return;
    const existing = this.map.get(key);
    if (existing) { this.bytes -= existing.byteLength; this.map.delete(key); }
    this.map.set(key, value);
    this.bytes += value.byteLength;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value as string;
      this.bytes -= this.map.get(oldest)!.byteLength;
      this.map.delete(oldest);
    }
  }
  get size() { return this.map.size; }
  get totalBytes() { return this.bytes; }
}

/** Runs at most `limit` tasks at once; the rest wait in order. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

// Only successful resizes are kept. The route checks the publish lookup before this runs, so unpublishing still takes
// an image down; there is deliberately no public Cache-Control.
const resizeCache = new ByteLruCache(24 * 1024 * 1024, 64);
const limitResizes = createLimiter(2);

/**
 * The asset, resized to a phone- or desktop-sized webp when `?w=` asks for an allowed width (#1207). Everything else,
 * including a non-raster file, a width not on the list, or an image sharp cannot read, is the original response.
 */
export async function eventAssetVariantResponse(asset: StoredAsset, widthParam: string | null) {
  const width = parseVariantWidth(widthParam);
  if (!width || !isResizableContentType(asset.contentType)) return eventAssetResponse(asset);

  const cacheKey = `${asset.storageKey}:${width}`;
  let resized = resizeCache.get(cacheKey);
  if (!resized) {
    try {
      resized = await limitResizes(async () => {
        const sharp = (await import("sharp")).default;
        return sharp(await readAsset(asset.storageKey))
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      });
    } catch {
      return eventAssetResponse(asset);
    }
    resizeCache.set(cacheKey, resized);
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
