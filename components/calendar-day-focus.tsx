"use client";

import { useEffect } from "react";

const FLAG = "calendar-day-activation";
const FLAG_TTL_MS = 5000;

/** Called by the day links on click: the next day detail that mounts is the result of this activation. */
export function markDayActivation() {
  try {
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    // Storage can be blocked; focus then simply stays where the browser put it.
  }
}

/**
 * Moves focus to the opened day's heading, but only right after a day link was activated in the page. Hard loads, refreshes,
 * back/forward and category clicks leave focus alone.
 */
export function CalendarDayFocus() {
  useEffect(() => {
    let fresh = false;
    try {
      const stamp = Number(sessionStorage.getItem(FLAG));
      sessionStorage.removeItem(FLAG);
      fresh = Number.isFinite(stamp) && stamp > 0 && Date.now() - stamp < FLAG_TTL_MS;
    } catch {
      fresh = false;
    }
    if (fresh) document.getElementById("calendar-day-heading")?.focus();
  }, []);
  return null;
}
