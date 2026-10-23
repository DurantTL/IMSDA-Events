// Keeps the phone builder's sticky Save draft and Preview bar above the on-screen keyboard (#1071). A phone keeps the
// page's layout size when the keyboard opens, so a bar fixed to the bottom would sit behind it; the visual viewport says
// how much of the bottom is covered, and the bar lifts by that much. Pure maths plus a small effect.
import { useEffect, type RefObject } from "react";

/** How far the bottom of the page is covered (by a keyboard): the layout height less what is actually visible. */
export function keyboardInset(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!viewport || !(viewport.height > 0)) return 0;
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

/** Below this the "covered" strip is a browser toolbar, not a keyboard, so the bar keeps its safe-area padding. */
export const KEYBOARD_MIN_INSET = 120;

export function useKeyboardInset(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!active || !element || !viewport) return;
    const target = element;
    const visual = viewport;
    function update() {
      // clientHeight is the layout viewport without scrollbars; innerHeight can include them.
      const inset = keyboardInset(document.documentElement.clientHeight, visual);
      target.style.setProperty("--fb-keyboard-inset", `${inset}px`);
      if (inset >= KEYBOARD_MIN_INSET) target.setAttribute("data-keyboard", "open"); else target.removeAttribute("data-keyboard");
    }
    // The bar's height, for the page's scroll padding, so a focused field is never left under it.
    const root = document.documentElement;
    function measure() { root.style.setProperty("--fb-phone-bar-height", `${Math.ceil(target.getBoundingClientRect().height)}px`); }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(target);
    measure();
    update();
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
      observer?.disconnect();
      root.style.removeProperty("--fb-phone-bar-height");
      target.style.removeProperty("--fb-keyboard-inset");
      target.removeAttribute("data-keyboard");
    };
  }, [ref, active]);
}
