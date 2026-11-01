"use client";

import { AlertTriangle } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export type ErrorSummaryItem = {
  /** Where the link goes: the id of the control (or its card) with the problem. */
  targetId: string | null;
  /** The message, already naming the attendee or session it is about. */
  message: string;
};

/** "2 things to fix before saving", the heading of the summary. `action` finishes the sentence: "signing in", "submitting". */
export function errorSummaryHeading(count: number, action = "saving") {
  return `${count} ${count === 1 ? "thing" : "things"} to fix before ${action}`;
}

/** "Label: message" for a summary item; a message that already starts with the label ("Phone must be...") stays as it is. */
export function summaryMessage(label: string, message: string) {
  return message.toLowerCase().startsWith(label.toLowerCase()) ? message : `${label}: ${message}`;
}

/** Move focus to the field a summary link points at and scroll it into view. A card or wrapper focuses its first control. */
export function focusFieldById(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return false;
  const control = target.matches("input, select, textarea, button, [tabindex]")
    ? target
    : target.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button");
  const element = (control ?? target) as HTMLElement;
  element.scrollIntoView?.({ block: "center" });
  element.focus({ preventScroll: true });
  return true;
}

/**
 * The state every form needs for the summary: collect the problems, call `show(items)`, and focus moves to the
 * summary once it has rendered. `clear()` hides it again (a successful submit).
 */
export function useFormErrorSummary() {
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ErrorSummaryItem[]>([]);
  const [shown, setShown] = useState(0);
  const show = useCallback((next: ErrorSummaryItem[]) => {
    setItems(next);
    setShown((count) => count + 1);
  }, []);
  const clear = useCallback(() => setItems([]), []);
  useEffect(() => {
    if (shown > 0) ref.current?.focus();
  }, [shown]);
  return { ref, items, show, clear };
}

/**
 * The linked summary at the top of a long form (#743). The caller focuses it
 * after a failed submit, each item links to its control, and an item's message
 * names whose answer it is about.
 */
export const FormErrorSummary = forwardRef<HTMLDivElement, {
  heading?: string;
  items: ErrorSummaryItem[];
  className?: string;
  /** Runs before the default focus move; call `event.preventDefault()` to take over (a collapsed block that must open first). */
  onFollow?: (event: MouseEvent<HTMLAnchorElement>, item: ErrorSummaryItem, index: number) => void;
  /** Finishes the default heading: "saving", "signing in", "submitting". */
  action?: string;
}>(function FormErrorSummary({ heading, items, className = "form-error-summary", onFollow, action }, ref) {
  return (
    <div className={className} ref={ref} role="alert" tabIndex={-1}>
      <strong><AlertTriangle aria-hidden="true" size={16} /> {heading ?? (items.length > 0 ? errorSummaryHeading(items.length, action) : "Review the highlighted fields.")}</strong>
      {items.length > 0 && (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.targetId ?? "general"}_${index}`}>
              {item.targetId
                ? <a href={`#${item.targetId}`} onClick={(event) => {
                  onFollow?.(event, item, index);
                  if (event.defaultPrevented) return;
                  if (focusFieldById(item.targetId as string)) event.preventDefault();
                }}>{item.message}</a>
                : item.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
