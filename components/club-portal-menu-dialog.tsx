"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import styles from "@/components/club-portal-nav.module.css";

export type ClubPortalMenuEntry = { key: string; label: string; href: string; current: boolean };

/**
 * The full list behind the club portal's menu line and the phone bar's More (#1641): the entries it is given, the current
 * one marked with the club portal's purple edge (the staff shell has its own `StaffMenuDialog`). A sheet on a phone
 * and a dialog on wider screens (the stylesheet decides). Following a link closes it; Back closes it; every other close
 * gives focus back to the button that opened it.
 */
export function ClubPortalMenuDialog({
  title,
  titleId,
  entries,
  onClose,
  returnTo,
}: {
  title: string;
  titleId: string;
  entries: readonly ClubPortalMenuEntry[];
  onClose: () => void;
  returnTo?: RefObject<HTMLElement | null>;
}) {
  const followed = useRef(false);
  const dialogRef: RefObject<HTMLDivElement | null> = useAccessibleDialog<HTMLDivElement>(true, onClose, {
    initialFocus: () => dialogRef.current?.querySelector<HTMLElement>("[aria-current]") ?? null,
    returnFocus: (opener) => (followed.current ? null : returnTo?.current ?? opener),
  });
  const follow = () => {
    followed.current = true;
    onClose();
  };
  // A navigation that does not come through a link here (browser Back) leaves the dialog behind; close it with the page.
  useEffect(() => {
    window.addEventListener("popstate", onClose);
    return () => window.removeEventListener("popstate", onClose);
  }, [onClose]);
  return createPortal(
    <>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-club-portal-menu>
        <div className={styles.dialogHead}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={`secondary-button ${styles.close}`} onClick={onClose}><X aria-hidden="true" size={18} /><span>Close</span></button>
        </div>
        <div className={styles.dialogBody}>
          <ul>
            {entries.map((entry) => (
              <li key={entry.key}>
                <Link className={styles.item} href={entry.href} aria-current={entry.current ? "true" : undefined} onClick={follow}>
                  <span>{entry.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>,
    document.body,
  );
}
