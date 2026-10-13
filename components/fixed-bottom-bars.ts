/**
 * Fixed or sticky bars along the bottom of the screen (the staff phone tab bar, a sticky
 * "Save classes / Continue" bar). Floating controls (Back to top, the Honor and Class lists)
 * stay clear of them instead of sitting under or over them.
 */

export type BarRect = { top: number; bottom: number; width: number };

/**
 * The top edge of the highest bottom-anchored bar, or null when there is none. A bar counts when it
 * reaches the bottom of the screen, starts in the lower half, and spans at least half the width
 * (a sticky bar only counts while it is actually stuck to the bottom). `reach` is how low a bar must extend to
 * count: the bottom of the screen by default; a floating control passes the top of its own corner so a sticky bar
 * resting just above the bottom edge (not stuck yet) is cleared too. Pure, so it is unit tested.
 */
export function bottomBarTop(rects: readonly BarRect[], viewportHeight: number, viewportWidth: number, reach = viewportHeight - 1.5): number | null {
  let top: number | null = null;
  for (const rect of rects) {
    if (rect.width < viewportWidth * 0.5 || rect.bottom < reach) continue;
    if (rect.top <= viewportHeight / 2 || rect.top >= viewportHeight) continue;
    top = top === null ? rect.top : Math.min(top, rect.top);
  }
  return top;
}

/** Every fixed or sticky element on the page (except `ignore` and what is inside it). Scanning every element is the costly part, so callers that measure often keep this list for a moment. */
export function findFixedOrStickyElements(ignore?: Element | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
    if (ignore && (el === ignore || ignore.contains(el))) continue;
    const style = window.getComputedStyle(el);
    if (style.position === "fixed" || style.position === "sticky") found.push(el);
  }
  return found;
}

/** The top of the highest bottom-anchored bar among `candidates`, measured now (hidden ones have no box and are skipped). */
export function bottomBarTopOf(candidates: readonly HTMLElement[], reach?: number): number | null {
  const rects: BarRect[] = [];
  for (const el of candidates) {
    if (!el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (window.getComputedStyle(el).visibility === "hidden") continue;
    rects.push({ top: rect.top, bottom: rect.bottom, width: rect.width });
  }
  return bottomBarTop(rects, window.innerHeight, window.innerWidth, reach);
}

/** One-shot: scan and measure. */
export function visibleBottomBarTop(ignore?: Element | null): number | null {
  return bottomBarTopOf(findFixedOrStickyElements(ignore));
}
