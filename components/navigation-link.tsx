"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/**
 * The pending cue is visual only (#1304): the link's own background animates while `data-navigation-pending` is "true"
 * (see globals.css). It adds no accessible text, so the route's loading status (`loading.tsx`) is the one announcement.
 */
export function NavigationPending({ pending }: { pending: boolean }) {
  return <span aria-hidden="true" data-navigation-pending={pending ? "true" : "false"} />;
}

function LinkPending() {
  const { pending } = useLinkStatus();
  return <NavigationPending pending={pending} />;
}

/** Next owns the pending state, including fast, cancelled and superseded navigations. No timers or extra requests. */
export function NavigationLink({ children, ...props }: Omit<ComponentProps<typeof Link>, "legacyBehavior">) {
  return <Link {...props}>{children}<LinkPending /></Link>;
}
