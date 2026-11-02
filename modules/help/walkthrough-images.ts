/**
 * Picture files for walkthrough steps (#1482). Pure: paths and sizes are worked out from ids, so the guide data, the capture
 * script, the stale check and the tests all agree. The files live in `public/help/walkthroughs/<guideId>/`.
 */
export type WalkthroughImageKind = "phone" | "desktop";

/** The phone picture is the 390 x 844 screen as is; the desktop picture is the 1280 x 800 screen resized to 960 wide. */
export const walkthroughImageSizes: Record<WalkthroughImageKind, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 960, height: 600 },
};

/** The browser window the capture script uses for each picture. */
export const walkthroughViewports: Record<WalkthroughImageKind, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** Screens at this width and up get the desktop picture (matches the `min-width` of the `<source>`). */
export const walkthroughDesktopMinWidth = 768;

/** Size budgets in bytes. Over the target is a warning in the tests' output; over the hard limit fails (docs/HELP-AND-LEARNING.md). */
export const walkthroughImageBudgets: Record<WalkthroughImageKind, { target: number; hardLimit: number }> = {
  phone: { target: 60 * 1024, hardLimit: 150 * 1024 },
  desktop: { target: 90 * 1024, hardLimit: 150 * 1024 },
};

export const walkthroughImageRoot = "/help/walkthroughs";
export const walkthroughManifestPath = `${walkthroughImageRoot}/manifest.json`;

/** `/help/walkthroughs/<guideId>/<nn>-<stepId>-<kind>.webp`, where nn is the 1-based step number with two digits. */
export function walkthroughImage(guideId: string, stepIndex: number, stepId: string, kind: WalkthroughImageKind) {
  const number = String(stepIndex + 1).padStart(2, "0");
  return { src: `${walkthroughImageRoot}/${guideId}/${number}-${stepId}-${kind}.webp`, ...walkthroughImageSizes[kind] };
}
