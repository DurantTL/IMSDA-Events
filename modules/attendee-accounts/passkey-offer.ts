/**
 * The "Add a passkey for faster sign-in" offer on the registration
 * confirmation (#219, first slice). Nothing is stored on the server: the page
 * decides eligibility from what it already knows, and "Not now" is a
 * timestamp kept in the visitor's own browser.
 */

/** Where the offer's button goes. */
export const PASSKEY_OFFER_PATH = "/account/security";

/** How long "Not now" hides the offer. */
export const PASSKEY_OFFER_SNOOZE_DAYS = 30;

/** Browser storage key for the "Not now" timestamp. */
export const PASSKEY_OFFER_SNOOZE_KEY = "imsda.passkeyOffer.snoozedAt";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether to offer a passkey at all. Needs passkeys switched on, the
 * registrant's own signed-in attendee account (not a staff view of one), no
 * passkey yet, and not a check-in station device. The browser check happens
 * on the device.
 */
export function passkeyOfferEligible(input: {
  passkeysOn: boolean;
  signedInAs: "attendee" | "staff" | null;
  passkeyCount: number;
  onCheckInStation: boolean;
}) {
  return input.passkeysOn
    && input.signedInAs === "attendee"
    && input.passkeyCount === 0
    && !input.onCheckInStation;
}

/** The value to store when the person taps "Not now". */
export function passkeyOfferSnoozeValue(now: Date) {
  return String(now.getTime());
}

/** Whether a stored "Not now" timestamp is still inside the 30 days. Unreadable values never hide the offer. */
export function passkeyOfferSnoozed(stored: string | null | undefined, now: Date) {
  if (!stored || !/^\d{1,16}$/.test(stored)) return false;
  const snoozedAt = Number(stored);
  const elapsed = now.getTime() - snoozedAt;
  return elapsed >= 0 && elapsed < PASSKEY_OFFER_SNOOZE_DAYS * DAY_MS;
}
