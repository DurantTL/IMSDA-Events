"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PASSKEY_OFFER_PATH,
  PASSKEY_OFFER_SNOOZE_KEY,
  passkeyOfferSnoozeValue,
  passkeyOfferSnoozed,
} from "@/modules/attendee-accounts/passkey-offer";
import styles from "@/components/registration-passkey-offer.module.css";

function readSnooze() {
  try {
    return window.localStorage.getItem(PASSKEY_OFFER_SNOOZE_KEY);
  } catch {
    return null;
  }
}

/**
 * Offers a passkey on the registration confirmation (#219). `eligible` is the
 * server's decision (passkeys on, own signed-in account, none yet, not a
 * check-in station). Renders nothing until this browser is checked, so it
 * never flashes in and out.
 */
export function RegistrationPasskeyOffer({ eligible, embedded = false }: { eligible: boolean; embedded?: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!eligible || typeof window === "undefined" || !window.PublicKeyCredential) return;
    if (passkeyOfferSnoozed(readSnooze(), new Date())) return;
    const available = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    let cancelled = false;
    // Browsers without the platform check still support passkeys (a security key), so they see the offer.
    Promise.resolve(typeof available === "function" ? available.call(window.PublicKeyCredential) : true).then(
      (supported) => { if (!cancelled && supported) setShow(true); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [eligible]);

  if (!eligible || !show) return null;

  function notNow() {
    try {
      window.localStorage.setItem(PASSKEY_OFFER_SNOOZE_KEY, passkeyOfferSnoozeValue(new Date()));
    } catch {
      // Storage can be blocked; the offer still closes for this visit.
    }
    setShow(false);
  }

  return (
    <section className={styles.offer} aria-labelledby="registration-passkey-offer-title">
      <h3 id="registration-passkey-offer-title">Add a passkey for faster sign-in</h3>
      <p>Next time, sign in with your fingerprint, face or screen lock instead of typing a code.</p>
      <div className={styles.actions}>
        {embedded ? (
          <a className="public-registration-secondary-button" href={PASSKEY_OFFER_PATH} target="_blank" rel="noopener noreferrer">Add a passkey</a>
        ) : (
          <Link className="public-registration-secondary-button" href={PASSKEY_OFFER_PATH}>Add a passkey</Link>
        )}
        <button className="public-registration-secondary-button" type="button" onClick={notNow}>Not now</button>
      </div>
    </section>
  );
}
