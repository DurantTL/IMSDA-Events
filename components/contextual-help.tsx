"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import type { ContextualHelpData } from "@/modules/help/contextual";
import styles from "./contextual-help.module.css";

/**
 * A "Help" button that opens a short guide in a modal dialog without leaving the page, so unsaved edits stay (#1259).
 * The dialog is the browser's own: Escape closes it, focus stays inside while it is open and comes back to the button
 * when it closes. It complements the page's inline labels and errors and never replaces them. It holds only a guide's
 * static text.
 */
export function ContextualHelp({ help }: { help: ContextualHelpData }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  // The dialog stays the browser's own (top layer, ::backdrop): state drives showModal() and close(). This runs before
  // the shared hook below, so the native dialog is already closed when the hook gives focus back to the button. It also
  // means showModal() has moved focus before the hook notes the opener, so returnFocus names the button.
  const nativeRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = nativeRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  const hookRef = useAccessibleDialog<HTMLDialogElement>(open, close, { returnFocus: () => triggerRef.current });
  const dialogRef = useCallback((node: HTMLDialogElement | null) => { nativeRef.current = node; hookRef.current = node; }, [hookRef]);

  return (
    <div className={styles.row}>
      <button
        aria-haspopup="dialog"
        className={`secondary-button ${styles.trigger}`}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        Help<span className="sr-only">: {help.title}</span>
      </button>
      <dialog
        aria-labelledby={titleId}
        className={styles.dialog}
        // Escape is the shared hook's; this stops the browser closing the dialog a second time and keeps the state in step.
        onCancel={(event) => { event.preventDefault(); close(); }}
        // Any native close (the hook then gives focus back to the button). The event arrives a task later, so a dialog
        // reopened in between is still open and ignores it.
        onClose={(event) => { if (!event.currentTarget.open) close(); }}
        ref={dialogRef}
      >
        <div className={styles.body}>
          <h2 className={styles.title} id={titleId}>{help.title}</h2>
          <p className={styles.text}>{help.summary}</p>
          <ol className={styles.steps}>{help.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className={styles.text}>Your changes on the page are kept while this is open.</p>
          <div className={styles.actions}>
            <a className={`secondary-button ${styles.action}`} href={help.fullHref} rel="noopener noreferrer" target="_blank">
              Open the full guide<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button className={`primary-button ${styles.action}`} onClick={close} type="button">Close</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
