"use client";

import { useEffect } from "react";
import { getSafeStorage, safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";

/**
 * A Content-Security-Policy belongs to the document, and a client-side
 * navigation keeps the policy of the page it left. The public event page's
 * policy admits the video and map frames (next.config.ts), so a visitor who
 * reached it through a `<Link>` from a page with the locked policy would see
 * blank frames. This asks for one full load of the page in that case; a visitor
 * who arrived by a normal page load is never reloaded.
 */
export function EventEmbedFullLoad() {
  useEffect(() => {
    try {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!entry) return;
      const trim = (path: string) => path.replace(/\/+$/, "") || "/";
      const key = `event-embed-reload:${window.location.pathname}`;
      if (trim(new URL(entry.name).pathname) === trim(window.location.pathname)) {
        // A normal load of this page: nothing to do, and the next client-side
        // arrival may reload once again.
        safeRemoveItem("session", key);
        return;
      }
      // Arrived by client-side navigation. Reload once for this navigation. The
      // reloaded document is a normal load (the branch above), so it cannot
      // loop; the timestamp is a second guard in case the browser reports a
      // different address for the loaded document, and expires so a later
      // navigation to this page in the same tab still reloads.
      // Without session storage the timestamp guard cannot work, so never reload: the frames may need a manual refresh.
      if (!getSafeStorage("session")) return;
      const last = Number(safeGetItem("session", key) ?? 0);
      if (Date.now() - last < 30_000) return;
      if (!safeSetItem("session", key, String(Date.now()))) return;
      window.location.reload();
    } catch {
      // Without these APIs the page still works; the frames may need a refresh.
    }
  }, []);
  return null;
}
