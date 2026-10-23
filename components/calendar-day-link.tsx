"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { markDayActivation } from "@/components/calendar-day-focus";

/** A link into a day's complete agenda; activating it asks the day detail to take focus. */
export function CalendarDayLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} onClick={(event) => { props.onClick?.(event); markDayActivation(); }} />;
}
