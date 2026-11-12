"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** How often a visible, online staff page asks the server for fresh numbers (#1577). */
export const LIVE_PAGE_REFRESH_MS = 30_000;
/**
 * A tab nobody has touched for this long stops refreshing, so an unattended screen still reaches the idle sign-out
 * instead of being kept signed in by its own refreshes. It resumes on the next touch or when the tab is shown again.
 */
export const LIVE_PAGE_ACTIVE_WINDOW_MS = 10 * 60_000;

export function shouldRefreshLivePage(input: {
  visible: boolean;
  online: boolean;
  lastInputAt: number;
  now: number;
}) {
  return input.visible && input.online && input.now - input.lastInputAt <= LIVE_PAGE_ACTIVE_WINDOW_MS;
}

/**
 * Keeps a server-rendered staff page current without a reload: refreshes it every 30 seconds while the tab is
 * visible and online, and once when the tab becomes visible again. `router.refresh()` re-renders the server parts and
 * merges them in, so client state, focus and scroll stay where they are. Renders nothing and says nothing.
 */
export function LivePageRefresh({ intervalMs = LIVE_PAGE_REFRESH_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let lastInputAt = Date.now();
    const touch = () => { lastInputAt = Date.now(); };
    const tick = () => {
      if (shouldRefreshLivePage({
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
        lastInputAt,
        now: Date.now(),
      })) {
        routerRef.current.refresh();
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      lastInputAt = Date.now();
      routerRef.current.refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    const inputs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const name of inputs) window.addEventListener(name, touch, { passive: true });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const name of inputs) window.removeEventListener(name, touch);
    };
  }, [intervalMs]);

  return null;
}
