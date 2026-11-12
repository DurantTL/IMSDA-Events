"use client";

import { Sparkles } from "lucide-react";

/** The page header is drawn by the server page, so the starter button asks the editor below it to add the sections. */
export const EVENT_GUIDE_STARTER_EVENT = "event-content:add-guide-starter";

export function EventContentStarterButton() {
  return (
    <button className="secondary-button" type="button" onClick={() => window.dispatchEvent(new Event(EVENT_GUIDE_STARTER_EVENT))}>
      <Sparkles size={16} aria-hidden="true" /> Add event guide starter
    </button>
  );
}
