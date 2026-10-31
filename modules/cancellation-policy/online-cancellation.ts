/**
 * Whether attendees of an event can ask to cancel online at all (#1408). Online requests are offered for registrations the
 * contact pays for; a club event, or one billed to a church or group, is handled by the event team (see `loadEligibility`
 * in cancellation-requests). Pure, so the cancellation request check and the event's readiness item share one rule.
 */
export function onlineCancellationApplies(event: { audience?: "GENERAL" | "CLUB" | null; billingMode?: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE" | null }) {
  return event.audience !== "CLUB" && event.billingMode === "ATTENDEE_PAY";
}
