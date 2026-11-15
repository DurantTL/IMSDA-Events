import "server-only";

import type { ImageDimensionReader } from "./assets";

/** Reads dimensions with sharp, turning a sideways photo (EXIF orientation 5 to 8) the right way up. Null when unreadable. */
export const readImageDimensionsWithSharp: ImageDimensionReader = async (bytes) => {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    const sideways = (meta.orientation ?? 1) >= 5;
    return sideways ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
};
