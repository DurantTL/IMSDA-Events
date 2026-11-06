"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GuardedLink } from "@/components/guarded-link";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { tabCurrent, type RowTab } from "@/components/staff-tab-row-model";
import styles from "./staff-shell.module.css";

/**
 * The full list behind the menu line (#1565): every tab of the row, each with its views, the current item marked with the
 * gold edge. A sheet on a phone and a dialog on wider screens (the stylesheet decides). Links are guarded, so an unsaved
 * form asks first; following one closes the dialog.
 */
export function StaffMenuDialog({
  title,
  titleId,
  tabs,
  onClose,
  returnTo,
}: {
  title: string;
  titleId: string;
  tabs: readonly RowTab[];
  onClose: () => void;
  returnTo?: RefObject<HTMLElement | null>;
}) {
  // Following a link leaves the page to its new content; every other close gives focus back to the menu button.
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
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-staff-menu>
        <div className={styles.dialogHead}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={`secondary-button ${styles.close}`} onClick={onClose}><X aria-hidden="true" size={18} /><span>Close</span></button>
        </div>
        <div className={styles.dialogBody}>
          <ul>
            {tabs.map((tab) => (
              <li key={tab.key} className={styles.group}>
                <GuardedLink className={styles.item} href={tab.href} aria-current={tabCurrent(tab)} onNavigate={follow}>
                  <span>{tab.label}</span>
                  {tab.count ? <span className={styles.count}>{tab.count}</span> : null}
                </GuardedLink>
                {tab.views && tab.views.length > 0 && (
                  <ul className={styles.subItems} aria-label={`${tab.label} views`}>
                    {tab.views.map((view) => (
                      <li key={view.key}>
                        <GuardedLink className={styles.item} href={view.href} aria-current={view.current ? "page" : undefined} onNavigate={follow}>{view.label}</GuardedLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>,
    document.body,
  );
}
