"use client";

import { useEffect } from "react";

/** Moves focus to the opened day's heading once, so keyboard and screen-reader users land on the complete dated agenda. */
export function CalendarDayFocus() {
  useEffect(() => {
    document.getElementById("calendar-day-heading")?.focus();
  }, []);
  return null;
}
