"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Info } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { STAFF_SIGN_IN_HREF } from "@/components/public-header-links";
import styles from "@/components/staff-signin-ended-notice.module.css";

export const STAFF_SIGN_IN_ENDED_TEXT = "Your staff sign-in ended. Sign in again to get back to the staff workspace.";
const STORAGE_PREFIX = "staff-signin-ended-seen:";

/** Whether this browser has already shown the notice for this sign-out. A failed read counts as not seen. */
export function noticeAlreadySeen(storage: Pick<Storage, "getItem"> | null, marker: string): boolean {
  try {
    return storage?.getItem(STORAGE_PREFIX + marker) === "1";
  } catch {
    return false;
  }
}

/** Records the notice as shown for this sign-out. A failed write is ignored. */
export function recordNoticeSeen(storage: Pick<Storage, "setItem"> | null, marker: string): void {
  try {
    storage?.setItem(STORAGE_PREFIX + marker, "1");
  } catch {
    // Storage blocked: the notice still shows and can be dismissed for this page view.
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const seenAtLoad = new Map<string, boolean>();
const dismissed = new Set<string>();
const noSubscribe = () => () => {};

/**
 * Whether the notice shows for this sign-out. The storage answer is read once per page session (so recording the key
 * on first display does not hide the notice mid-view); a dismissal is remembered here and in storage, so coming back
 * to Overview by in-page navigation, or reloading, does not bring it back.
 */
export function isNoticeVisible(storage: Pick<Storage, "getItem"> | null, marker: string): boolean {
  if (dismissed.has(marker)) return false;
  let seen = seenAtLoad.get(marker);
  if (seen === undefined) {
    seen = noticeAlreadySeen(storage, marker);
    seenAtLoad.set(marker, seen);
  }
  return !seen;
}

/** Dismissal: remembered for this page session and recorded in storage. */
export function dismissNotice(storage: Pick<Storage, "setItem"> | null, marker: string): void {
  dismissed.add(marker);
  recordNoticeSeen(storage, marker);
}

/**
 * The "your staff sign-in ended" notice on /account (#1947), shown once per sign-out. `marker` is an opaque value the
 * server derives from this browser's ended staff session; the browser remembers it so a later visit stays quiet.
 * It reuses the overview's neutral card look (not the coral error notice) and sits in the same column as the cards.
 */
export function StaffSignInEndedNotice({ marker }: { marker: string }) {
  const [, setTick] = useState(0);
  const visible = useSyncExternalStore(noSubscribe, () => isNoticeVisible(browserStorage(), marker), () => true);
  useEffect(() => {
    recordNoticeSeen(browserStorage(), marker);
  }, [marker]);
  if (!visible) return null;
  return (
    <div className={styles.wrap}>
      <div className={`attendee-ov-empty ${styles.notice}`} role="status">
        <Info size={20} aria-hidden="true" />
        <div>
          <p>
            {STAFF_SIGN_IN_ENDED_TEXT}{" "}
            <Link className={`empty-state-link ${styles.link}`} href={STAFF_SIGN_IN_HREF}>Staff sign-in</Link>
          </p>
        </div>
        <button
          className={`secondary-button ${styles.dismiss}`}
          type="button"
          aria-label="Dismiss the staff sign-in notice"
          onClick={() => {
            dismissNotice(browserStorage(), marker);
            setTick((tick) => tick + 1);
            // The button is about to disappear: hand focus to the page's main heading.
            const heading = document.querySelector<HTMLElement>("main h1");
            if (heading) {
              heading.setAttribute("tabindex", "-1");
              heading.focus();
            }
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
