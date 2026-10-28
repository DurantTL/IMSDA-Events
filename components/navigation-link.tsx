"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/** Always mounted so a real pending navigation can announce itself without moving the link's label. */
export function NavigationPending({ pending }: { pending: boolean }) {
  return <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-navigation-pending={pending ? "true" : "false"}>{pending ? "Opening page…" : ""}</span>;
}

function LinkPending() {
  const { pending } = useLinkStatus();
  return <NavigationPending pending={pending} />;
}

/** Next owns the pending state, including fast, cancelled and superseded navigations. No timers or extra requests. */
export function NavigationLink({ children, ...props }: Omit<ComponentProps<typeof Link>, "legacyBehavior">) {
  return <Link {...props}>{children}<LinkPending /></Link>;
}
