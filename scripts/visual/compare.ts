import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/** A pixel counts as different when its colour is further than this from the baseline's (0 strict, 1 anything). */
export const PIXEL_THRESHOLD = 0.1;
/** A page fails when more than this share of its pixels differ (0.001 is 0.1%). */
export const MAX_DIFFERING_SHARE = 0.001;

export type Comparison =
  | { ok: true; differing: number; total: number; share: number }
  | { ok: false; reason: "size" | "pixels"; message: string; differing: number; total: number; share: number; diff?: Buffer };

/**
 * Compares two PNG pictures. Different sizes fail at once (the page got longer or wider). Otherwise the pictures are
 * compared pixel by pixel, ignoring anti-aliasing, and fail when more than MAX_DIFFERING_SHARE of the pixels differ.
 * The difference picture is returned only when there is something to show.
 */
export function compareImages(baseline: Buffer, current: Buffer): Comparison {
  const before = PNG.sync.read(baseline);
  const after = PNG.sync.read(current);
  const total = Math.max(before.width * before.height, after.width * after.height);
  if (before.width !== after.width || before.height !== after.height) {
    return {
      ok: false, reason: "size", differing: total, total, share: 1,
      message: `the picture is ${after.width}x${after.height}, the baseline is ${before.width}x${before.height}`,
    };
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const differing = pixelmatch(before.data, after.data, diff.data, before.width, before.height, { threshold: PIXEL_THRESHOLD, includeAA: false });
  const share = total === 0 ? 0 : differing / total;
  if (share > MAX_DIFFERING_SHARE) {
    return {
      ok: false, reason: "pixels", differing, total, share, diff: PNG.sync.write(diff),
      message: `${differing} of ${total} pixels differ (${(share * 100).toFixed(3)}%, the limit is ${(MAX_DIFFERING_SHARE * 100).toFixed(1)}%)`,
    };
  }
  return { ok: true, differing, total, share };
}
