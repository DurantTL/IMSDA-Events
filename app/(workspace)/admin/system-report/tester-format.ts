import { useEffect } from "react";

/** Local-time display for the tester cards. Times only appear after a run, so nothing differs between server and client. */
export function clockTime(iso: string | null, withSeconds = true) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
}

/** Calls `clear` when a rate-limit time passes, so the button comes back without a reload. */
export function useLimitExpiry(until: string | null, clear: () => void) {
  useEffect(() => {
    if (!until) return;
    const timer = window.setTimeout(clear, Math.max(0, new Date(until).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [until, clear]);
}
