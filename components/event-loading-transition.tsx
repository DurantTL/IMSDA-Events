"use client";

import { useParams } from "next/navigation";
import { EventCardTransition } from "@/components/event-card-transition";
import { eventViewTransitionName } from "@/modules/events/view-transition";

/** Wraps the event page's loading section so the card's morph forms while the skeleton shows (#1208). */
export function EventLoadingTransition({ children }: { children: React.ReactNode }) {
  const params = useParams<{ eventSlug?: string | string[] }>();
  const raw = params?.eventSlug;
  const slug = Array.isArray(raw) ? raw[0] : raw;
  let decoded: string | null = null;
  if (slug) {
    try { decoded = decodeURIComponent(slug); } catch { decoded = null; }
  }
  return <EventCardTransition name={decoded ? eventViewTransitionName(decoded) : null}>{children}</EventCardTransition>;
}
