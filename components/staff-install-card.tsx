"use client";

import { Share } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { useStandalone } from "@/components/staff-saved-app-guide";
import { INSTALL_CARD_DISMISSED_KEY, installCardVariant } from "@/lib/staff-install-card";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";
import styles from "./staff-install-card.module.css";

/** The browser's install prompt event. It is not in the DOM typings. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/*
 * Capture state lives at module level, not in a component effect. Chromium fires `beforeinstallprompt` once per page load,
 * possibly before React finishes hydrating and on whichever staff page opened first. The staff layout renders
 * StaffInstallPromptCapture, so this module loads with every staff page and a prompt kept on, say, Events is still there
 * after a client-side move to Home. That is as early as we can attach without a script in the document head. A page that fired the event before this chunk ran would miss it, which only
 * means no card on that load (the Help guide still explains it). Nothing is stored: the event lives in memory.
 */
let deferredPrompt: InstallPromptEvent | null = null;
let appInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    appInstalled = true;
    notify();
  });
}

function subscribeInstall(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** Same-tab changes to the stored choice (the storage event only reaches other tabs). */
const dismissListeners = new Set<() => void>();
function subscribeDismissed(onChange: () => void) {
  dismissListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    dismissListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
const notifyDismissed = () => dismissListeners.forEach((listener) => listener());
const readDismissed = () => safeGetItem("local", INSTALL_CARD_DISMISSED_KEY) !== null;
// Nothing is shown on the server or first paint: dismissed is "true" until the browser has spoken.
const serverDismissed = () => true;

/** Whether the "Not now" choice is stored on this device. Storage that throws reads as not chosen. */
export function useInstallCardDismissed(): boolean {
  return useSyncExternalStore(subscribeDismissed, readDismissed, serverDismissed);
}

export function restoreInstallCard() {
  safeRemoveItem("local", INSTALL_CARD_DISMISSED_KEY);
  notifyDismissed();
}

const getPrompt = () => deferredPrompt;
const getInstalled = () => appInstalled;
const serverFalse = () => false;
const serverNull = () => null;

/** Renders nothing: importing it from the staff layout loads the listeners above on every staff page (#1836). */
export function StaffInstallPromptCapture() {
  return null;
}

/** Staff Home: a small, dismissible card that helps save the app to a phone or tablet (#1836). */
export function StaffInstallCard() {
  const standalone = useStandalone();
  const dismissed = useInstallCardDismissed();
  const prompt = useSyncExternalStore(subscribeInstall, getPrompt, serverNull);
  const installed = useSyncExternalStore(subscribeInstall, getInstalled, serverFalse);

  const variant = typeof navigator === "undefined" ? "none" : installCardVariant({
    userAgent: navigator.userAgent,
    platform: navigator.platform ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    installPromptAvailable: prompt !== null,
    dismissed,
    installed,
  });

  const notNow = useCallback(() => {
    safeSetItem("local", INSTALL_CARD_DISMISSED_KEY, "1");
    notifyDismissed();
  }, []);

  const install = useCallback(async () => {
    const event = deferredPrompt;
    if (!event) return;
    // The browser allows one prompt per event.
    deferredPrompt = null;
    notify();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") {
        appInstalled = true;
        notify();
      }
    } catch {
      // The prompt could not open; the card is gone for this page load and Help still explains how to save.
    }
  }, []);

  if (variant === "none") return null;

  return (
    <section className={styles.card} aria-labelledby="install-card-heading">
      <h2 id="install-card-heading" className={styles.heading}>Save IMAdventist to your Home Screen</h2>
      {variant === "install" ? (
        <p className={styles.text}>Add an icon that opens your staff Home. The website works fine without it.</p>
      ) : null}
      {variant === "ios-safari" ? (
        <ol className={styles.steps}>
          <li>
            Tap Share <Share className={styles.icon} size={18} aria-hidden="true" focusable="false" />
          </li>
          <li>Choose Add to Home Screen. On newer iOS, make sure Open as Web App is on.</li>
          <li>Tap Add.</li>
        </ol>
      ) : null}
      {variant === "ios-other-browser" ? (
        <p className={styles.text}>To add this to your Home Screen, open this page in Safari, then tap Share and choose Add to Home Screen.</p>
      ) : null}
      <div className={styles.actions}>
        {variant === "install" ? (
          <button type="button" className="primary-button" onClick={install}>Install</button>
        ) : null}
        <button type="button" className="secondary-button" onClick={notNow}>Not now</button>
      </div>
    </section>
  );
}

/** Help: bring the Home card back after "Not now". Shown only while the choice is stored. */
export function StaffInstallCardRestore() {
  const dismissed = useInstallCardDismissed();
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, serverFalse);
  if (!hydrated || !dismissed) return null;
  return (
    <div className={styles.restore}>
      <button type="button" className="secondary-button" onClick={restoreInstallCard}>Show the Home Screen card on Home again</button>
    </div>
  );
}
