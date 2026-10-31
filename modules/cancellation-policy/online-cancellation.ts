/**
 * Whether attendees of an event can ask to cancel online at all (#1408). Online requests are offered for registrations the
 * contact pays for; a club event, or one billed to a church or group, is handled by the event team (see `loadEligibility`
 * in cancellation-requests). Pure, so the cancellation request check and the event's readiness item share one rule.
 * The request check passes only `billingMode` (club registrations are refused there per registration), so a club event
 * left on attendee pay still allows requests; publishing such an event is already blocked by the club billing item.
 */
export function onlineCancellationApplies(event: { audience?: "GENERAL" | "CLUB" | null; billingMode?: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE" | null }) {
  return event.audience !== "CLUB" && event.billingMode === "ATTENDEE_PAY";
}
