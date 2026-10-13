"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/** The button appears once the page is scrolled past this many screen heights... */
export const BACK_TO_TOP_SHOW_AT = 1.5;
/** ...and goes away again once the person is back within this many screen heights of the top. */
export const BACK_TO_TOP_HIDE_AT = 1;

/**
 * Whether the Back to top button shows. It appears after about a screen and a
 * half of scrolling and, so it does not flicker around that line, stays until
 * the person is back within one screen of the top. Pure, so it is tested
 * without a browser.
 */
export function backToTopVisible(scrollY: number, viewportHeight: number, wasVisible: boolean): boolean {
  if (!(viewportHeight > 0)) return false;
  return scrollY > viewportHeight * (wasVisible ? BACK_TO_TOP_HIDE_AT : BACK_TO_TOP_SHOW_AT);
}

/**
 * "Back to top" for long club pages. A fixed 44px button in the bottom corner
 * that appears after scrolling down. Using it scrolls to the top (instantly
 * when the person asked their device for reduced motion) and moves focus to
 * the page heading, so keyboard and screen reader users start from the top
 * again instead of staying beside a button that has just disappeared.
 */
export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      setVisible((current) => {
        const next = backToTopVisible(window.scrollY, window.innerHeight, current);
        return next === current ? current : next;
      });
    }
    function onScroll() {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  function goToTop() {
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const main = document.querySelector<HTMLElement>("main");
    const target = main?.querySelector<HTMLElement>("h1") ?? main;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    if (!target) return;
    // A heading is not focusable by default: allow script focus only while it has it.
    const addedTabIndex = !target.hasAttribute("tabindex");
    if (addedTabIndex) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (addedTabIndex) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }

  if (!visible) return null;
  return (
    <button aria-label="Back to top" className="back-to-top-button" onClick={goToTop} title="Back to top" type="button">
      <ArrowUp aria-hidden="true" size={20} />
    </button>
  );
}
