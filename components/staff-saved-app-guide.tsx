"use client";

import { useSyncExternalStore } from "react";
import styles from "./staff-saved-app-guide.module.css";

const QUERY = "(display-mode: standalone)";

function subscribe(onChange: () => void) {
  try {
    const query = window.matchMedia(QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => undefined;
  }
}

function isStandalone(): boolean {
  try {
    return window.matchMedia(QUERY).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Whether this page is open as a saved app (#1567). The server and first paint assume a browser. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, isStandalone, () => false);
}

/**
 * Staff Help: how to save IMAdventist to the Home Screen (#1567). In the saved app it says so instead.
 * There is no install button: Safari does not offer one to a page, and an embedded preview may not offer the menu at all.
 */
export function StaffSavedAppGuide() {
  const standalone = useStandalone();
  return (
    <section className={styles.card} aria-labelledby="saved-app-heading">
      <h2 id="saved-app-heading" className={styles.heading}>Save IMAdventist to your Home Screen</h2>
      {standalone ? (
        <p className={styles.status} role="status">You are using the saved app. It opens your staff Home each time.</p>
      ) : (
        <>
          <p className={styles.lead}>The website works fine in your browser. Saving it just gives you an icon that opens your staff Home.</p>
          <h3 className={styles.sub}>iPhone or iPad (Safari)</h3>
          <ol className={styles.steps}>
            <li>Open the staff Home in Safari, not in a preview inside another app.</li>
            <li>Tap Share.</li>
            <li>Choose Add to Home Screen. On newer iOS, make sure Open as Web App is on.</li>
            <li>Tap Add.</li>
          </ol>
          <h3 className={styles.sub}>Computer or Android</h3>
          <p className={styles.text}>If your browser offers Install or Add to Home screen in its menu, use that. Not every browser does.</p>
        </>
      )}
      <ul className={styles.facts}>
        <li>You sign in inside the saved app separately. It keeps its own sign-in, not shared with Safari.</li>
        <li>Signing out works the same way as on the website.</li>
        <li>It needs an internet connection. Nothing is saved for offline use.</li>
      </ul>
    </section>
  );
}
