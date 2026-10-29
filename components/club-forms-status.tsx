"use client";

import { useEffect, useRef, useState } from "react";

const EVENT_NAME = "club-forms-status";

/**
 * Tells the page a club forms action worked (#1323). The row or button that
 * ran it can be gone after the page refreshes, so the message and focus live
 * in `ClubFormsStatus`, which stays mounted at the top of the page.
 */
export function announceClubForms(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(EVENT_NAME, { detail: message }));
}

/** A polite status region. When a message arrives, focus moves here so it is not lost with the removed row. */
export function ClubFormsStatus() {
  const [message, setMessage] = useState("");
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onStatus(event: Event) {
      setMessage((event as CustomEvent<string>).detail);
      region.current?.focus();
    }
    window.addEventListener(EVENT_NAME, onStatus);
    return () => window.removeEventListener(EVENT_NAME, onStatus);
  }, []);

  return (
    <div aria-live="polite" role="status" ref={region} tabIndex={-1} data-testid="club-forms-status">
      {message && <p className="inline-notice success">{message}</p>}
    </div>
  );
}
