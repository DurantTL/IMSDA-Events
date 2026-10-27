"use client";

import { useEffect } from "react";

/**
 * The chip row scrolls sideways (#1249), so a shared link to a chip off screen would hide the selected one. After load and
 * after each filter change, scroll the row (never the page) so the active chip is in view; instant under reduced motion.
 */
export function CalendarChipScroll({ active }: { active: string }) {
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(".calendar-categories");
    const chip = row?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!row || !chip) return;
    const visible = chip.offsetLeft >= row.scrollLeft && chip.offsetLeft + chip.offsetWidth <= row.scrollLeft + row.clientWidth;
    if (visible) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2), behavior: reduced ? "auto" : "smooth" });
  }, [active]);
  return null;
}
