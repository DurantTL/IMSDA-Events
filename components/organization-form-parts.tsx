"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import styles from "@/components/organization-pages.module.css";

/** What a save or a change said last, and which slot on the page shows it (#1592). */
export type SaveResultState = { tone: "success" | "error"; text: string; slot: string };

/**
 * The one result next to a form. A failed save takes focus, so a keyboard or screen-reader user lands on the reason
 * with every typed value still in the fields. A new failure moves focus again, even with the same words.
 */
export function SaveResult({ result, slot }: { result: SaveResultState | null; slot: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = result && result.slot === slot ? result : null;
  useEffect(() => {
    if (shown?.tone === "error") ref.current?.focus();
  }, [shown]);
  if (!shown) return null;
  return (
    <div className={styles.result} ref={ref} tabIndex={-1}>
      <FormMessage message={shown.text} tone={shown.tone} />
    </div>
  );
}

/**
 * A Save button that stays focusable while the save is in flight: `aria-disabled` and a click guard instead of
 * `disabled`, so keyboard focus is not lost. It reads "Saving…" and looks dimmed. The form's own submit handler must
 * also return early while `held`, because Enter in a field submits the form without a click.
 */
export function HeldSaveButton({ held, label, heldLabel = "Saving…", icon, id, className = "primary-button" }: {
  held: boolean;
  label: string;
  heldLabel?: string;
  icon?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <button
      aria-busy={held || undefined}
      aria-disabled={held || undefined}
      className={`${className} ${styles.held}`}
      id={id}
      onClick={(event) => { if (held) event.preventDefault(); }}
      type="submit"
    >
      {held ? <LoaderCircle aria-hidden="true" className="submit-button-spinner is-spinning" size={16} /> : icon}
      {held ? heldLabel : label}
    </button>
  );
}

/** A plain action button held the same way while something is saving: still focusable, dimmed, and a click does nothing. */
export function HeldButton({ held, onAction, children, className = "secondary-button", ariaLabel }: { held: boolean; onAction: () => void; children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <button aria-disabled={held || undefined} aria-label={ariaLabel} className={`${className} ${styles.held}`} onClick={() => { if (!held) onAction(); }} type="button">
      {children}
    </button>
  );
}

/** An error inside a dialog's form. It takes focus when it appears, so the reason is read with every typed value still in place. */
export function DialogError({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [text]);
  return <p className={`form-error ${styles.result}`} ref={ref} role="alert" tabIndex={-1}>{text}</p>;
}
