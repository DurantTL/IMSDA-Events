import { useEffect } from "react";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

/** Conference-time display (labeled) for the tester cards, so the server and the browser agree. */
export function clockTime(iso: string | null, withSeconds = true) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return formatInConferenceTime(date, { hour: "numeric", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
}

/** Calls `clear` when a rate-limit time passes, so the button comes back without a reload. */
export function useLimitExpiry(until: string | null, clear: () => void) {
  useEffect(() => {
    if (!until) return;
    const timer = window.setTimeout(clear, Math.max(0, new Date(until).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [until, clear]);
}
