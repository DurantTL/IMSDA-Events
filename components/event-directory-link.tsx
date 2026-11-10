"use client";

import type { ReactNode } from "react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { rememberLastUsedEvent } from "@/components/remember-last-event";

/**
 * An event's row link in the directory. With `remember`, opening it also records the event as the last-used one, as the
 * `/select-event` choices always have (#108); the other lists leave it out (an archived event is never chosen automatically,
 * #635). Still an ordinary link, so it works without script.
 */
export function EventDirectoryLink({ href, eventId, remember = false, className, children }: { href: string; eventId: string; remember?: boolean; className?: string; children: ReactNode }) {
  return (
    <Link
      className={className}
      href={href}
      onClick={remember ? () => rememberLastUsedEvent(eventId) : undefined}
      onAuxClick={remember ? () => rememberLastUsedEvent(eventId) : undefined}
    >
      {children}
    </Link>
  );
}
