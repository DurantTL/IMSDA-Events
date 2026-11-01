import type { EventSettingsRecord } from "@/modules/events/repository";
import { eventSettingsInputSchema, type EventSettingsInput } from "@/modules/events/schemas";
import { fieldErrorsFromIssues } from "@/modules/events/settings-layout";

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
    paymentDueOn: event?.paymentDueOn ?? null,
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
    featured: event?.featured ?? false,
    featuredOrder: event?.featuredOrder ?? null,
    featureUntil: event?.featureUntil ?? null,
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
    paymentDueOn: draft.paymentDueOn || null,
    capacity: draft.capacity || null,
    featuredOrder: draft.featuredOrder || null,
    featureUntil: draft.featureUntil || null,
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

/**
 * What the settings form's own HTML attributes used to enforce before it turned the browser bubbles off (#1450):
 * the required name, address, dates and times, the address pattern, the end not before the start, the capacity
 * range and the web address. The server schema decides the rest, so its problems are folded in here and the
 * form can show every one in its summary. Keyed like the server's field errors; the server still checks again.
 */
export function eventSettingsClientProblems(draft: EventSettingsInput, mode: "create" | "edit"): Record<string, string> {
  const found: Record<string, string> = {};
  if (!draft.startsOn) found.startsOn = "Enter the start date.";
  if (!draft.endsOn) found.endsOn = "Enter the end date.";
  if (mode === "create" && !draft.startTime) found.startTime = "Enter the start time.";
  if (mode === "create" && !draft.endTime) found.endTime = "Enter the end time.";
  if (draft.capacity !== null && draft.capacity !== undefined && (!Number.isInteger(draft.capacity) || draft.capacity < 1 || draft.capacity > 100_000)) {
    found.capacity = "Enter a whole number from 1 to 100,000, or leave it blank for no limit.";
  }
  const bookingUrl = draft.hotelBookingUrl?.trim();
  if (bookingUrl && !URL.canParse(bookingUrl)) found.hotelBookingUrl = "Enter a full web address, like https://example.com.";
  const parsed = eventSettingsInputSchema.safeParse(eventSettingsRequestBody(draft));
  if (!parsed.success) {
    for (const [key, message] of Object.entries(fieldErrorsFromIssues(parsed.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part !== "symbol"), message: issue.message }))))) {
      if (!found[key]) found[key] = message;
    }
  }
  return found;
}
