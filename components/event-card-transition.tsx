import * as React from "react";

type ViewTransitionProps = { name?: string; share?: string; default?: string; children?: React.ReactNode };

/**
 * Shared-element transition between an event card and the event page header (#1208). `ViewTransition` ships in the
 * React canary that Next's app runtime bundles, but not in stable React or its types, so it is read at runtime and the
 * children render unwrapped when it is missing or there is no name.
 */
export function EventCardTransition({ name, children }: { name: string | null | undefined; children: React.ReactNode }) {
  const ViewTransition = (React as unknown as { ViewTransition?: React.ComponentType<ViewTransitionProps> }).ViewTransition;
  if (!ViewTransition || !name) return <>{children}</>;
  return <ViewTransition name={name} share="event-card" default="none">{children}</ViewTransition>;
}
