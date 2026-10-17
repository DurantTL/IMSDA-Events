"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { bottomBarTopOf, findFixedOrStickyElements } from "@/components/fixed-bottom-bars";

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
  // How far to lift the button so it sits above a fixed or sticky bar along the bottom (0 when there is none).
  const [lift, setLift] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let frame = 0;
    let candidates: HTMLElement[] = [];
    let scannedAt = -Infinity;
    function update() {
      frame = 0;
      setVisible((current) => {
        const next = backToTopVisible(window.scrollY, window.innerHeight, current);
        return next === current ? current : next;
      });
      // The list of fixed and sticky elements is rescanned about once a second; their positions are read every frame.
      const now = performance.now();
      if (now - scannedAt > 1000) {
        candidates = findFixedOrStickyElements(buttonRef.current);
        scannedAt = now;
      }
      const barTop = bottomBarTopOf(candidates.filter((el) => !buttonRef.current?.contains(el)), window.innerHeight - 72);
      const next = barTop === null ? 0 : Math.max(0, Math.ceil(window.innerHeight - barTop + 12));
      setLift((current) => (current === next ? current : next));
    }
    function onScroll() {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    }
    function onResize() {
      scannedAt = -Infinity;
      onScroll();
    }
    // A bar that turns sticky once the reader has scrolled (a class change, #996) joins the list at once, not up to a second later.
    const barObserver = typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
        if (records.some((record) => /sticky|pinned/.test(String((record.target as HTMLElement).className ?? "")))) onResize();
      })
      : null;
    barObserver?.observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      barObserver?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
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
    <button
      aria-label="Back to top"
      className="back-to-top-button"
      onClick={goToTop}
      ref={buttonRef}
      style={lift > 0 ? { bottom: lift } : undefined}
      title="Back to top"
      type="button"
    >
      <ArrowUp aria-hidden="true" size={20} />
    </button>
  );
}
