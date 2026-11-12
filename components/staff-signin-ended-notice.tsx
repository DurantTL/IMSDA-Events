"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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
const noSubscribe = () => () => {};

/** What this browser already knew when the notice first asked: later writes do not hide it mid-view. */
function wasSeenBefore(marker: string): boolean {
  let seen = seenAtLoad.get(marker);
  if (seen === undefined) {
    seen = noticeAlreadySeen(browserStorage(), marker);
    seenAtLoad.set(marker, seen);
  }
  return seen;
}

/**
 * The "your staff sign-in ended" notice on /account (#1947), shown once per sign-out. `marker` is an opaque value the
 * server derives from the staff sign-out; the browser remembers it so a later visit for the same sign-out stays quiet.
 * It renders on the server and first paint, then hides itself if the marker was already seen.
 */
export function StaffSignInEndedNotice({ marker }: { marker: string }) {
  const [dismissed, setDismissed] = useState(false);
  const seenBefore = useSyncExternalStore(noSubscribe, () => wasSeenBefore(marker), () => false);
  useEffect(() => {
    recordNoticeSeen(browserStorage(), marker);
  }, [marker]);
  if (dismissed || seenBefore) return null;
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        {STAFF_SIGN_IN_ENDED_TEXT}{" "}
        <Link className={styles.link} href={STAFF_SIGN_IN_HREF}>Staff sign-in</Link>
      </p>
      <button className={`secondary-button ${styles.dismiss}`} type="button" aria-label="Dismiss the staff sign-in notice" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}
