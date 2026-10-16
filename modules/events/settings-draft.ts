import type { EventSettingsRecord } from "@/modules/events/repository";
import type { EventSettingsInput } from "@/modules/events/schemas";

/**
 * The event settings form's draft, and the request body a save sends (#965 moved
 * them out of `event-settings-workspace.tsx`). The Event features page changes the
 * event columns with the same `PATCH /api/events/{id}` the form uses, so it must
 * send exactly what the form would: every field of the stored event, the dates it
 * was loaded with (the stale-write guard of #445), and blank text as `null`.
 */
export function draftFromEvent(event: EventSettingsRecord | null): EventSettingsInput {
  return {
    name: event?.name ?? "",
    slug: event?.slug ?? "",
    startsOn: event?.startsOn ?? "",
    endsOn: event?.endsOn ?? "",
    timezone: (event?.timezone as EventSettingsInput["timezone"] | undefined)
      ?? "America/Chicago",
    location: event?.location ?? null,
    capacity: event?.capacity ?? null,
    publicInfoUrl: event?.publicInfoUrl ?? null,
    supportContact: event?.supportContact ?? null,
    tagline: event?.tagline ?? null,
    subtitle: event?.subtitle ?? null,
    helpEmail: event?.helpEmail ?? null,
    hubTitle: event?.hubTitle ?? null,
    hubIntro: event?.hubIntro ?? null,
    refundPolicy: event?.refundPolicy ?? null,
    hotelName: event?.hotelName ?? null,
    hotelBookingUrl: event?.hotelBookingUrl ?? null,
    hotelPhone: event?.hotelPhone ?? null,
    hotelGroupName: event?.hotelGroupName ?? null,
    hotelRate: event?.hotelRate ?? null,
    hotelInstructions: event?.hotelInstructions ?? null,
    registrationOpensOn: event?.registrationOpensOn ?? null,
    registrationClosesOn: event?.registrationClosesOn ?? null,
    collectsShirtSizes: event?.collectsShirtSizes ?? false,
    checksAdultBackgrounds: event?.checksAdultBackgrounds ?? false,
    hostedPaymentLinkEnabled: event?.hostedPaymentLinkEnabled ?? false,
    attendeeEditPolicy: event?.attendeeEditPolicy ?? "VERIFY_EVERY_EDIT",
    billingMode: event?.billingMode ?? "ATTENDEE_PAY",
    audience: event?.audience ?? "GENERAL",
    approvedPaymentInstructions: event?.approvedPaymentInstructions ?? null,
    seminarPreferenceClosesOn: event?.seminarPreferenceClosesOn ?? null,
    seminarPreferenceSelfServiceLocked:
      event?.seminarPreferenceSelfServiceLocked ?? false,
    waitlistEnabled: event?.waitlistEnabled ?? false,
    autoPromoteWaitlist: event?.waitlistEnabled
      ? (event.autoPromoteWaitlist ?? false)
      : false,
  };
}

/** The settings save body: the draft with blank optional text and numbers sent as `null`. */
export function eventSettingsRequestBody(draft: EventSettingsInput) {
  return {
    ...draft,
    location: draft.location || null,
    publicInfoUrl: draft.publicInfoUrl || null,
    supportContact: draft.supportContact || null,
    tagline: draft.tagline || null,
    subtitle: draft.subtitle || null,
    helpEmail: draft.helpEmail || null,
    hubTitle: draft.hubTitle || null,
    hubIntro: draft.hubIntro || null,
    refundPolicy: draft.refundPolicy || null,
    registrationOpensOn: draft.registrationOpensOn || null,
    registrationClosesOn: draft.registrationClosesOn || null,
    capacity: draft.capacity || null,
  };
}

/**
 * The body that changes one event column from outside the settings form (the
 * Event features page). `event` must be the event as the server holds it right
 * now (the page fetches it with `GET /api/events/{id}` on every toggle), so the
 * save sends back every other field as it is stored and changes only the one
 * flag; a field another admin changed after the page loaded is never put back.
 * The dates come from the same fetch for the stale-write guard (#445). Turning
 * the waitlist off turns automatic promotion off with it, as the form does,
 * because the schema refuses the other mix.
 */
export function eventColumnChangeBody(
  event: EventSettingsRecord,
  change: Partial<Pick<EventSettingsInput, "waitlistEnabled" | "autoPromoteWaitlist" | "collectsShirtSizes" | "hostedPaymentLinkEnabled" | "checksAdultBackgrounds">>,
) {
  const draft = { ...draftFromEvent(event), ...change };
  if (change.waitlistEnabled === false) draft.autoPromoteWaitlist = false;
  return {
    ...eventSettingsRequestBody(draft),
    expectedStartsOn: event.startsOn,
    expectedEndsOn: event.endsOn,
  };
}
