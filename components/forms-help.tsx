"use client";

import { CircleHelp, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/components/forms-help.module.css";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { telHref, type FormsHelpContact } from "@/modules/system-admin/forms-help-contact";

/**
 * The small "Forms help" link and popup (#1445): ad-blocker and browser fixes, translation steps in English and Spanish,
 * and the help contact. A quiet text-style button in normal page flow; the popup is a compact dialog on desktop and a
 * short bottom sheet on a phone. Every section starts collapsed (native details), so only headings show until tapped.
 * Dialog behavior (focus trap, Escape, focus back to the button) comes from the shared useAccessibleDialog hook.
 */
export function FormsHelp({ contact, className }: { contact: FormsHelpContact; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const dialogRef = useAccessibleDialog<HTMLElement>(open, close);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={className ?? styles.trigger}
        data-forms-help-trigger=""
        onClick={() => setOpen(true)}
        type="button"
      >
        <CircleHelp aria-hidden="true" size={16} />
        Forms help
      </button>
      {open && createPortal(
        <div
          className={`modal-backdrop ${styles.backdrop}`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
          role="presentation"
        >
          <section aria-labelledby="forms-help-title" aria-modal="true" className={`modal-card ${styles.card}`} ref={dialogRef} role="dialog" tabIndex={-1}>
            <div className={styles.head}>
              <h2 id="forms-help-title">Forms help</h2>
              <button aria-label="Close" className={`icon-button modal-close-button ${styles.close}`} onClick={close} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <FormsHelpSections contact={contact} />
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

/** A row in page flow that holds the link, so it is never a bare child of a layout that hides buttons (the phone submit card). */
export function FormsHelpRow({ contact, align = "start" }: { contact: FormsHelpContact; align?: "start" | "end" }) {
  return (
    <div className={align === "end" ? `${styles.row} ${styles.rowEnd}` : styles.row}>
      <FormsHelp contact={contact} />
    </div>
  );
}

/** The three collapsed sections. Exported so the content can be tested without opening the dialog. */
export function FormsHelpSections({ contact }: { contact: FormsHelpContact }) {
  return (
    <div className={styles.sections}>
      <details className={styles.section}>
        <summary>Having form issues?</summary>
        <div className={styles.body}>
          <p>If something won&apos;t submit, turn off ad blockers, VPNs or privacy extensions for this site, then reload.</p>
          <ul>
            <li><strong>Brave:</strong> select the lion icon in the address bar, then turn Shields off for this site.</li>
            <li><strong>Avast:</strong> open the Avast shield or extension icon and allow this site.</li>
          </ul>
          <p>Still not working? Clear your browser cache, restart your browser, or restart your device.</p>
          <p>Recommended browsers: Chrome, Edge, Firefox, Safari.</p>
        </div>
      </details>
      <details className={styles.section}>
        <summary>Need translation?<span lang="es"> / ¿Necesita traducción?</span></summary>
        <div className={styles.body}>
          <ul className={styles.steps}>
            <li className={styles.desktopStep}><strong>Chrome or Edge:</strong> right-click the page and choose Translate, or select the translate icon in the address bar.</li>
            <li className={styles.phoneStep}><strong>Safari on iPhone:</strong> tap aA, then Translate.</li>
          </ul>
          <ul className={styles.steps} lang="es">
            <li className={styles.desktopStep}><strong>Chrome o Edge:</strong> haga clic derecho en la página y elija Traducir, o toque el ícono de traducir en la barra de direcciones.</li>
            <li className={styles.phoneStep}><strong>Safari en iPhone:</strong> toque aA y luego Traducir.</li>
          </ul>
        </div>
      </details>
      <details className={styles.section}>
        <summary>Need more help?</summary>
        <div className={styles.body} translate="no">
          <p><a href={`mailto:${contact.email}`}>{contact.email}</a></p>
          <p><a href={telHref(contact.phone)}>{contact.phone}</a></p>
        </div>
      </details>
    </div>
  );
}
