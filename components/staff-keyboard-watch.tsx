"use client";

import { useEffect } from "react";
import { opensKeyboard } from "@/components/staff-keyboard-model";

/**
 * Keeps the fixed bottom bar from covering a field while the on-screen keyboard is up (#1566). While a text field has focus
 * the page root carries `data-keyboard="open"`; the stylesheet then slides the phone bar off the bottom (still focusable, so a closing sheet can return focus to More) and lets a pinned save bar rejoin the
 * page flow (app/globals.css, docs/RESPONSIVE.md). It follows focus, not the visual viewport or `interactive-widget`: iOS
 * Safari ignores that viewport option and reports the keyboard through visualViewport only some of the time, while focus is
 * the same signal everywhere. The attribute only matters at phone width (the rules sit in a max-width query), so a
 * hardware keyboard on a tablet never hides anything. Renders nothing.
 */
export function StaffKeyboardWatch() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      if (opensKeyboard(document.activeElement as HTMLElement | null)) root.setAttribute("data-keyboard", "open");
      else root.removeAttribute("data-keyboard");
    };
    // Moving from one field to the next blurs and refocuses in the same turn; checking after it avoids a flash of the bar.
    const afterFocusChange = () => window.setTimeout(sync, 0);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", afterFocusChange);
    // A page restored from the back/forward cache, or a tab coming back, may have lost or kept its focus: look again, so the bar can never stay hidden.
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", afterFocusChange);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", sync);
      root.removeAttribute("data-keyboard");
    };
  }, []);
  return null;
}
