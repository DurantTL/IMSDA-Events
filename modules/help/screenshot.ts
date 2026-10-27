import type { GuideScreenshot } from "@/modules/help/types";

/** The caption every guide screenshot carries: it is a picture of sample data, never of real records. */
export const screenshotCaption = "Example with sample data";

/** The note shown when the guide was reviewed after the picture was taken. */
export const screenshotStaleNote = "This picture may be out of date; the steps above are current.";

/**
 * Whether the picture is older than the guide's last review. Both are `YYYY-MM-DD`, which sort as text. Only a
 * later review makes it stale: a guide re-checked on the day the picture was taken is not.
 */
export function screenshotIsStale(guide: { lastReviewed: string; screenshot?: Pick<GuideScreenshot, "capturedFor"> }): boolean {
  return Boolean(guide.screenshot) && guide.lastReviewed > guide.screenshot!.capturedFor;
}
