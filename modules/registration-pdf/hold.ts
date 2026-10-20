/**
 * The hold on a message that is waiting for its registration PDF (#1082). The PDF is made after the registration's
 * transaction commits (never inside the gated submit or the amendment transaction), so the messages are queued first,
 * held for a short time, and released the moment the PDF is attached or has failed. The outbox claims only rows whose
 * `availableAt` has passed, so neither the post-commit send nor the sweep can send one early. If the process dies before
 * the release, the hold simply runs out and the message goes without the PDF.
 */
export const REGISTRATION_PDF_HOLD_MS = 2 * 60 * 1000;

export function registrationPdfHoldUntil(now = new Date()) {
  return new Date(now.getTime() + REGISTRATION_PDF_HOLD_MS);
}
