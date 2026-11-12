"use client";

import { Share } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStandalone } from "@/components/saved-app-guide";
import { INSTALL_CARD_DISMISSED_KEYS, installCardVariant, type InstallCardAudience } from "@/lib/install-card";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";
import styles from "./install-card.module.css";

/** The browser's install prompt event. It is not in the DOM typings. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/*
 * Capture state lives at module level, not in a component effect. Chromium fires `beforeinstallprompt` once per page load,
 * possibly before React finishes hydrating and on whichever page opened first. The staff layout and the account portal layout
 * render InstallPromptCapture, so this module loads with every staff and account page and a prompt kept on, say, Events is
 * still there after a client-side move to Home. That is as early as we can attach without a script in the document head. A page that fired the event before this chunk ran would miss it, which only
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
/*
 * "Not now" for this page load. Storage can be blocked (a private window, "block all site data"); the click must still hide
 * the card, so the choice is also held in memory. Only a stored choice lasts past a reload.
 */
const dismissedThisLoad: Record<InstallCardAudience, boolean> = { staff: false, account: false };
const readDismissed = (audience: InstallCardAudience) =>
  dismissedThisLoad[audience] || safeGetItem("local", INSTALL_CARD_DISMISSED_KEYS[audience]) !== null;
// Nothing is shown on the server or first paint: dismissed is "true" until the browser has spoken.
const serverDismissed = () => true;

/** Whether the "Not now" choice is stored on this device. Storage that throws reads as not chosen. */
export function useInstallCardDismissed(audience: InstallCardAudience): boolean {
  return useSyncExternalStore(subscribeDismissed, () => readDismissed(audience), serverDismissed);
}

export function restoreInstallCard(audience: InstallCardAudience) {
  dismissedThisLoad[audience] = false;
  safeRemoveItem("local", INSTALL_CARD_DISMISSED_KEYS[audience]);
  notifyDismissed();
}

/** What each card says. The facts and steps are shared; only the place the icon opens and the Help wording differ. */
const COPY: Record<InstallCardAudience, { install: string; hidden: string; restoreButton: string; restored: string }> = {
  staff: {
    install: "Add an icon that opens your staff Home. The website works fine without it.",
    hidden: "Hidden. You can bring this back from Help.",
    restoreButton: "Show the Home Screen card on Home again",
    restored: "The card will show on Home again.",
  },
  account: {
    install: "Add an icon that opens your account, for your registrations, clubs and payments. The website works fine without it.",
    hidden: "Hidden. You can bring this back from Help.",
    restoreButton: "Show the Home Screen card on your account again",
    restored: "The card will show on your account again.",
  },
};

/** The Web Install API (`navigator.install()`), when this browser has it. Preferred over the older prompt event. */
function supportsWebInstall(): boolean {
  return typeof Navigator !== "undefined" && typeof (Navigator.prototype as { install?: unknown }).install === "function";
}

const getPrompt = () => deferredPrompt;
const getInstalled = () => appInstalled;
const serverFalse = () => false;
const serverNull = () => null;

/** Renders nothing: importing it from the staff and account layouts loads the listeners above on every such page (#1836, #1713). */
export function InstallPromptCapture() {
  return null;
}

/** A small, dismissible card that helps save the app to a phone or tablet: staff Home (#1836) and the account overview (#1713). */
export function InstallCard({ audience }: { audience: InstallCardAudience }) {
  const standalone = useStandalone();
  const dismissed = useInstallCardDismissed(audience);
  const prompt = useSyncExternalStore(subscribeInstall, getPrompt, serverNull);
  const installed = useSyncExternalStore(subscribeInstall, getInstalled, serverFalse);

  const variant = typeof navigator === "undefined" ? "none" : installCardVariant({
    userAgent: navigator.userAgent,
    platform: navigator.platform ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    installPromptAvailable: prompt !== null,
    webInstallAvailable: supportsWebInstall(),
    dismissed,
    installed,
  });

  // After "Not now" the focused button is gone: a short status line takes its place and takes focus, so keyboard and
  // screen-reader users hear what happened and keep their place (#1836).
  const [justHidden, setJustHidden] = useState(false);
  const hiddenRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (justHidden) hiddenRef.current?.focus(); }, [justHidden]);

  const notNow = useCallback(() => {
    dismissedThisLoad[audience] = true;
    safeSetItem("local", INSTALL_CARD_DISMISSED_KEYS[audience], "1");
    setJustHidden(true);
    notifyDismissed();
  }, [audience]);

  // Called straight from the click handler so the browser still sees the tap (transient user activation).
  const install = useCallback(async () => {
    if (supportsWebInstall()) {
      try {
        await (navigator as Navigator & { install: () => Promise<unknown> }).install();
        appInstalled = true;
        notify();
      } catch {
        // Cancelled (AbortError) or could not start: the card stays so the person can try again, and Help still explains.
      }
      return;
    }
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

  if (justHidden) {
    return (
      <p className={styles.notice} ref={hiddenRef} role="status" tabIndex={-1}>
        {COPY[audience].hidden}
      </p>
    );
  }
  if (variant === "none") return null;

  return (
    <section className={styles.card} aria-labelledby="install-card-heading">
      <h2 id="install-card-heading" className={styles.heading}>Save IMAdventist to your Home Screen</h2>
      {variant === "install" ? (
        <p className={styles.text}>{COPY[audience].install}</p>
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

/** Help: bring the card back after "Not now". Shown only while the choice is stored. */
export function InstallCardRestore({ audience }: { audience: InstallCardAudience }) {
  const dismissed = useInstallCardDismissed(audience);
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, serverFalse);
  // After the click the button is gone: a status line takes its place and focus, as on Home.
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (restored) restoredRef.current?.focus(); }, [restored]);
  if (restored) {
    return (
      <p className={styles.notice} ref={restoredRef} role="status" tabIndex={-1}>
        {COPY[audience].restored}
      </p>
    );
  }
  if (!hydrated || !dismissed) return null;
  return (
    <div className={styles.restore}>
      <button type="button" className="secondary-button" onClick={() => { restoreInstallCard(audience); setRestored(true); }}>{COPY[audience].restoreButton}</button>
    </div>
  );
}
