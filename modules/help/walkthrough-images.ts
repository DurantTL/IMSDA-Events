/**
 * Picture files for walkthrough steps (#1482). Pure: paths and sizes are worked out from ids, so the guide data, the capture
 * script, the stale check and the tests all agree. The files live in `public/help/walkthroughs/<guideId>/`.
 */
export type WalkthroughImageKind = "phone" | "desktop";

/**
 * The size each picture is shown at, in CSS pixels (#1840). The phone picture fits on one phone screen with its instruction.
 * The file itself is `walkthroughImageScale` times larger, so text stays sharp on high-density screens.
 */
export const walkthroughImageSizes: Record<WalkthroughImageKind, { width: number; height: number }> = {
  phone: { width: 390, height: 640 },
  desktop: { width: 960, height: 600 },
};

/**
 * The part of the screen each picture keeps, in CSS pixels. A phone picture is cropped to this size around the marked control,
 * so the step's own part of the page fills it. A desktop picture is not cropped: it shows the whole 1280 x 800 screen, so no
 * name or heading is cut off at the sides, and the browser scales it down to the shown size.
 */
export const walkthroughCropSizes: Record<WalkthroughImageKind, { width: number; height: number }> = {
  phone: { width: 390, height: 640 },
  desktop: { width: 1280, height: 800 },
};

/** File pixels per shown pixel: a phone picture file is 780 x 1280, a desktop one 1440 x 900. */
export const walkthroughImageScale: Record<WalkthroughImageKind, number> = { phone: 2, desktop: 1.5 };

/** The size of the picture file in pixels. */
export function walkthroughImageFileSize(kind: WalkthroughImageKind) {
  const size = walkthroughImageSizes[kind];
  const scale = walkthroughImageScale[kind];
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

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

/** A rectangle on the screen in CSS pixels: the marked control, or an area a step wants in view. */
export type MarkArea = { left: number; top: number; right: number; bottom: number };

/**
 * Where a picture's window starts along one axis: centred on the mark and the extra area together, but always with the mark
 * in view. A mark taller than the window keeps its start edge in view (with a little space before it).
 */
function windowStart(markStart: number, markEnd: number, areaStart: number, areaEnd: number, size: number, screen: number) {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(min, value), max));
  const first = Math.min(markStart, areaStart);
  const last = Math.max(markEnd, areaEnd);
  if (markEnd - markStart > size - 24) return clamp(markStart - 12, 0, screen - size);
  // Keep the whole mark inside the window, then fit as much of the area as the window can hold.
  const wanted = (first + last) / 2 - size / 2;
  return clamp(Math.min(Math.max(wanted, markEnd - size), markStart), 0, screen - size);
}

/**
 * The part of the screen a picture shows, in CSS pixels: the crop size, centred on the mark (and on the optional
 * extra `area` a step wants in view, such as a person's whole card) and kept inside the screen. When the mark and the area are
 * together larger than the crop, the mark stays in view. A mark taller (or wider) than the crop keeps its top (or left) edge in
 * view. With no mark, the top of the screen. A crop as big as the screen (desktop) is always the whole screen.
 */
export function walkthroughCrop(kind: WalkthroughImageKind, mark: MarkArea | null, area: MarkArea | null = null) {
  const { width, height } = walkthroughCropSizes[kind];
  const viewport = walkthroughViewports[kind];
  if (!mark) return { left: 0, top: 0, width, height };
  const extra = area ?? mark;
  const left = windowStart(mark.left, mark.right, extra.left, extra.right, width, viewport.width);
  const top = windowStart(mark.top, mark.bottom, extra.top, extra.bottom, height, viewport.height);
  return { left, top, width, height };
}

