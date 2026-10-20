/**
 * What an email path should do when it is told "no email is going out for this event" (#1043). Pure, so it needs
 * neither the database nor `server-only`.
 *
 * `DISABLED` is never produced by the effective-delivery function any more, but the old guards that keyed on it
 * (record the message as SUPPRESSED, refuse to start an offer clock) must still hold when an administrator has PAUSED
 * the event. A paused event captures email and sends nothing, so a waitlist offer whose clock starts on it would run
 * for nothing.
 */

type Delivery = { deliveryMode?: string | null; deliveryReason?: string | null } | null | undefined;

/** The note to record when a message must be written as SUPPRESSED, or `null` when it should be queued as usual. */
export function suppressionNote(delivery: Delivery): string | null {
  if (delivery?.deliveryMode === "DISABLED") return "Delivery is disabled for this event.";
  if (delivery?.deliveryReason === "PAUSED") return "Email is paused for this event by a system administrator.";
  return null;
}

/**
 * Why an action that needs the email to actually reach someone (an offer with a clock on it) must not start, or `null`.
 * Also holds while the central sender is blank: those messages wait and go out later, but the clock would already run.
 */
export function startBlockedNote(delivery: Delivery): string | null {
  const suppression = suppressionNote(delivery);
  if (suppression) {
    return delivery?.deliveryReason === "PAUSED"
      ? "Email is paused for this event by a system administrator, so the guest would never receive the offer. Ask a system administrator to resume it on System management > Email first."
      : "Email delivery is disabled for this event, so the guest would never receive the offer.";
  }
  if (delivery?.deliveryReason === "SENDER_MISSING") {
    return "The central sender address is not set, so the offer email would wait and not reach the guest. Set it on System management > Email first.";
  }
  return null;
}
