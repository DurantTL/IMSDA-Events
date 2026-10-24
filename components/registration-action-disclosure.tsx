"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * One contextual action on a registration card (#1176): a labelled native disclosure, so the summary is a keyboard
 * button (Enter or Space) with its expanded state announced, and no focus trap is needed because the panel is part of
 * the page. The panel's content mounts when first opened and then stays mounted, so a half-filled form or a payment
 * in progress is not lost by closing and reopening, and a payment form is not started for a card nobody opened.
 */
export function RegistrationActionDisclosure({
  label,
  hint,
  children,
}: {
  label: string;
  /** A short visible status after the label, such as "2 requests". */
  hint?: string;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="attendee-reg-action"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>
        <span>{label}</span>
        {hint && <span className="attendee-reg-action-hint">{hint}</span>}
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <div className="attendee-reg-action-panel">{opened ? children : null}</div>
    </details>
  );
}
