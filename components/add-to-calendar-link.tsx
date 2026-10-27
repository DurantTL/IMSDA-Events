"use client";

import { useState } from "react";
import { CalendarPlus, Check } from "lucide-react";

export const addedToCalendarMessage = "Added to calendar";

/** The visible label: the original wording, or "Added" once the download was used (#1211). The tick is added separately, hidden from readers. */
export function addToCalendarLabel(added: boolean, label: string) {
  return added ? "Added" : label;
}

/** The event page's Add-to-calendar link. The download works as before; after a click the label reads "Added ✓". */
export function AddToCalendarLink({ href, label }: { href: string; label: string }) {
  const [added, setAdded] = useState(false);
  return (
    <>
      <a
        className={`secondary-button public-event-status-action add-to-calendar-link${added ? " is-added" : ""}`}
        href={href}
        onClick={() => setAdded(true)}
      >
        {added ? <Check size={18} aria-hidden="true" /> : <CalendarPlus size={18} aria-hidden="true" />} {addToCalendarLabel(added, label)}
        {added && <span aria-hidden="true"> ✓</span>}
      </a>
      <span aria-live="polite" className="sr-only" role="status">{added ? addedToCalendarMessage : ""}</span>
    </>
  );
}
