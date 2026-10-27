"use client";

import { useId, useRef } from "react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={styles.row}>
      <button
        aria-haspopup="dialog"
        className={`secondary-button ${styles.trigger}`}
        onClick={() => dialogRef.current?.showModal()}
        ref={triggerRef}
        type="button"
      >
        Help<span className="sr-only">: {help.title}</span>
      </button>
      <dialog
        aria-labelledby={titleId}
        className={styles.dialog}
        // The native dialog returns focus on close; this makes it explicit for browsers that do not.
        onClose={() => triggerRef.current?.focus()}
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
            <button className={`primary-button ${styles.action}`} onClick={() => dialogRef.current?.close()} type="button">Close</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
