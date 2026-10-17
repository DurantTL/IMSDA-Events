"use client";

import { useEffect, useState, type RefObject } from "react";

/** Whether a bar should be pinned: past the anchor (its bottom edge above the screen), or, with no anchor, scrolled more than `afterPx`. */
export function isPinned(anchorBottom: number | null, scrollY: number, afterPx: number): boolean {
  return anchorBottom === null ? scrollY > afterPx : anchorBottom < 0;
}

/**
 * True once the reader has scrolled past `anchorRef` (its bottom edge is above the top of the
 * screen). A sticky action bar uses it (#996): until then the bar stays in the page flow after the
 * content, so it never sits on top of the intro or the step heading when the page opens. After the
 * reader has started scrolling it is pinned to the bottom of the screen within reach of a thumb. With `null` for the anchor
 * it pins once the page has been scrolled more than `afterPx`.
 */
export function usePinAfterScroll(anchorRef: RefObject<HTMLElement | null> | null, afterPx = 80): boolean {
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      // With no anchor, the bar pins once the page has been scrolled a little.
      const anchor = anchorRef?.current;
      if (anchorRef !== null && !anchor) return setPinned(false);
      setPinned(isPinned(anchor ? anchor.getBoundingClientRect().bottom : null, window.scrollY, afterPx));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [anchorRef, afterPx]);
  return pinned;
}
