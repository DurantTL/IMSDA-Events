import { DUPLICATE_PUBLIC_FORMS_MESSAGE, duplicatePublicFormGroups, publicFormLookKey } from "@/modules/forms/duplicate-public-forms";

export type EventReadinessSource = {
  name?: string | null;
  slug?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  timezone?: string | null;
  location?: string | null;
  publicInfoUrl?: string | null;
  supportContact?: string | null;
  audience?: "GENERAL" | "CLUB" | null;
  billingMode?: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE" | null;
  /** The event's id, for the link on the attendee-types item. */
  id?: string | null;
  /**
   * Active attendee types with a minimum age of 18 or more (#1403), the rule that makes an attendee an adult. Every
   * production caller loads it; a pure caller that omits it leaves the "Attendee types set" item out, never reports it
   * done. The server gate (`assertEventReadyToPublish`) always loads it.
   */
  attendeeTypesWithAgeRangeCount?: number | null;
  /** Labels of the event's active attendee types, for the done line of the attendee-types item. */
  attendeeTypeNames?: readonly string[] | null;
  /**
   * The platform's central email sender address as saved (`loadCentralSender`). `undefined` means "not loaded": the item
   * is left out. `null` or blank is loaded and not saved, so the item is undone and publishing is blocked (#1408).
   */
  centralSenderEmail?: string | null;
  /** Whether a cancellation policy is in effect (`eventHasCancellationPolicy`); `undefined` leaves the recommendation out. */
  hasCancellationPolicy?: boolean;
};

/** Shown as the publish blocker and the settings/readiness flag (#565). */
export const CLUB_EVENT_BILLING_MESSAGE = "Club registration uses church billing — choose it before publishing.";

/**
 * Shown as the publish blocker when the central email sender address is not saved (#1408). Event staff cannot fix it:
 * only a system administrator saves the sender, so the message says who to ask.
 */
export const CENTRAL_SENDER_MESSAGE = "The central email sender address is not saved, so confirmation and reminder emails could not be sent. Ask a system administrator to set this up.";

/** Where event staff are sent to ask for the sender address (they cannot change it). */
export const CENTRAL_SENDER_HELP_HREF = "/help";

export type EventReadinessItem = {
  id: "basics" | "location" | "support" | "registration-form" | "central-sender" | "attendee-types" | "club-billing";
  label: string;
  detail: string;
  complete: boolean;
  /** Where to fix it, when the item points at one page. */
  href?: string;
  /** The link text for `href` while the item is not done. */
  actionLabel?: string;
};

/**
 * Recommended items (#1408, #467): never counted toward "ready" and never a publish blocker. Event information no longer
 * lives on a required IMSDA.org page, and a cancellation policy only decides whether attendees can ask to cancel online.
 * They are reported separately so a caller that wants to show them can, without folding them into readiness math.
 */
export type EventReadinessRecommendedItem = {
  id: "cancellation-policy" | "public-info";
  label: string;
  detail: string;
  complete: boolean;
  /** Where to fix it, when the item points at one page. */
  href?: string;
  actionLabel?: string;
};

export const pastEventPublishWarning =
  "This event's dates have passed; public registration will be closed.";

/**
 * Warnings shown when publishing (#575). Unlike readiness items they never
 * block publishing: an event whose last day has passed can still be published
 * (for example to show its page), it just won't take public registrations.
 * `endsOn` is a calendar date (YYYY-MM-DD) in the event time zone.
 */
export function getEventPublishWarnings(
  event: { endsOn?: string | null; timezone?: string | null },
  now = new Date(),
) {
  if (!event.endsOn || !event.timezone) return [];
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: event.timezone,
  }).format(now);
  return today > event.endsOn ? [pastEventPublishWarning] : [];
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function isPublicWebUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The attendee-types link: the event's attendee configuration page. */
function attendeeTypesHref(id: string | null | undefined) {
  return id ? `/more/attendee-configuration?event=${encodeURIComponent(id)}` : undefined;
}

function listNames(names: readonly string[]) {
  return `${names.join(", ")}.`;
}

/**
 * "Attendee types set" (#1403, required by #1408): attendee types matter for general events, never club events. Age class
 * comes only from a type's age range, so without an adult type every attendee's age is unknown and scheduled email reaches
 * nobody. Required before publishing a GENERAL event. Null for a club event, and for a caller that has not loaded the count.
 */
export function getAttendeeTypesReadinessItem(
  event: Pick<EventReadinessSource, "audience" | "id" | "attendeeTypesWithAgeRangeCount" | "attendeeTypeNames">,
): EventReadinessItem | null {
  if (event.audience === "CLUB" || typeof event.attendeeTypesWithAgeRangeCount !== "number") return null;
  const done = event.attendeeTypesWithAgeRangeCount > 0;
  const names = (event.attendeeTypeNames ?? []).filter(hasText);
  const href = attendeeTypesHref(event.id);
  return {
    id: "attendee-types",
    label: "Attendee types set",
    detail: done
      ? names.length > 0 ? listNames(names) : "An adult attendee type tells scheduled email who is an adult."
      : "Attendee types decide who is an adult, youth or child, which sets prices and who gets each email.",
    complete: done,
    ...(href ? { href, actionLabel: "Set attendee types" } : {}),
  };
}

/** "Central email sender saved" (#1408): the address is set, not the email environment. Null when the caller has not loaded it. */
export function getCentralSenderReadinessItem(event: Pick<EventReadinessSource, "centralSenderEmail">): EventReadinessItem | null {
  if (event.centralSenderEmail === undefined) return null;
  const address = event.centralSenderEmail?.trim() ?? "";
  const done = address.length > 0;
  return {
    id: "central-sender",
    label: "Central email sender saved",
    detail: done
      ? `Emails go out from ${address}.`
      : "Confirmation and reminder emails wait until a system administrator saves the sender address.",
    complete: done,
    ...(done ? {} : { href: CENTRAL_SENDER_HELP_HREF, actionLabel: "Ask a system administrator" }),
  };
}

export function getEventPublishReadiness(
  event: EventReadinessSource,
  publishedFormCount: number,
) {
  const items: EventReadinessItem[] = [
    {
      id: "basics",
      label: "Event name, web address, dates, and timezone",
      detail: "These identify the event and place it correctly on the calendar.",
      complete: [
        event.name,
        event.slug,
        event.startsOn,
        event.endsOn,
        event.timezone,
      ].every(hasText),
    },
    {
      id: "location",
      label: "Event location",
      detail: "A venue, campus, or clear location note is ready for attendees.",
      complete: hasText(event.location),
    },
    {
      id: "support",
      label: "Support contact",
      detail: "Attendees know who to contact with registration questions.",
      complete: hasText(event.supportContact),
    },
    {
      id: "registration-form",
      label: "Published registration form",
      detail: "At least one tested form is published for this event.",
      complete: publishedFormCount > 0,
    },
  ];

  const centralSenderItem = getCentralSenderReadinessItem(event);
  if (centralSenderItem) items.push(centralSenderItem);
  // GENERAL events only (#1408): a club event has no attendee types of its own to set.
  const attendeeTypesItem = getAttendeeTypesReadinessItem(event);
  if (attendeeTypesItem) items.push(attendeeTypesItem);

  // Directors only see CLUB events billed to the church (#565), so a CLUB
  // event set to attendee-pay would 404 for them. Listed only for CLUB
  // events, and never auto-corrected: a billing change is a human decision.
  if (event.audience === "CLUB") {
    items.push({
      id: "club-billing",
      label: "Church billing for club registration",
      detail: `${CLUB_EVENT_BILLING_MESSAGE} Directors only see club events billed to the church, so set billing mode to church invoice in event settings.`,
      complete: event.billingMode === "DEFERRED_ORGANIZATION_INVOICE",
    });
  }

  const recommendedItems: EventReadinessRecommendedItem[] = [];
  if (typeof event.hasCancellationPolicy === "boolean") {
    const policyHref = event.id ? `/finance/cancellation-policy?event=${encodeURIComponent(event.id)}` : undefined;
    recommendedItems.push({
      id: "cancellation-policy",
      label: "Cancellation policy set",
      detail: event.hasCancellationPolicy
        ? "Attendees can ask to cancel online under this policy."
        : "Without one, attendees can't ask to cancel online. They see a line telling them to contact the support contact.",
      complete: event.hasCancellationPolicy,
      ...(!event.hasCancellationPolicy && policyHref ? { href: policyHref, actionLabel: "Set a cancellation policy" } : {}),
    });
  }
  // Complete when nothing is set (there is nothing to fix) or when the
  // configured value is a valid web address. Never a blocker either way.
  const publicInfoComplete = !hasText(event.publicInfoUrl) || isPublicWebUrl(event.publicInfoUrl);
  recommendedItems.push({
    id: "public-info",
    label: "IMSDA.org information page",
    detail: publicInfoComplete
      ? "Only if a separate IMSDA.org page also describes the event."
      : "The saved address isn't a complete http:// or https:// web address. Fix it or clear it.",
    complete: publicInfoComplete,
  });

  return {
    ready: items.every((item) => item.complete),
    completedCount: items.filter((item) => item.complete).length,
    items,
    recommendedItems,
    recommendedOpenCount: recommendedItems.filter((item) => !item.complete).length,
  };
}

/**
 * Setup reminders that never block publishing (#593). Directors and staff
 * still see them until the work is done: a location never edited, and a fee
 * field with no amount (pricing is a human decision, so nothing sets it for
 * them).
 */
export type EventReadinessWarning = {
  id: string;
  label: string;
  detail: string;
  /** Where to fix it, when the warning points at one place (#617). */
  href?: string;
};

/** A location saved within this long of its creation counts as never edited. */
const NEVER_EDITED_WINDOW_MS = 1000;

/**
 * A location with no dates of its own uses the event's dates, so blank dates
 * are valid. Warn only "until edited": an active location with neither a first
 * nor a last day that nobody has saved since it was created (for example one a
 * starter made). One date set, or any save by staff, never warns.
 */
export function getLocationDateWarnings(
  locations: ReadonlyArray<{
    name: string;
    firstDay: string | null;
    lastDay: string | null;
    isActive: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>,
): EventReadinessWarning[] {
  return locations
    .filter((location) => location.isActive
      && !location.firstDay
      && !location.lastDay
      && Math.abs(new Date(location.updatedAt).getTime() - new Date(location.createdAt).getTime()) <= NEVER_EDITED_WINDOW_MS)
    .map((location) => ({
      id: `location-dates:${location.name}`,
      label: `Check the dates for ${location.name}`,
      detail: "It uses the event's dates until you set its own.",
    }));
}

type FeeFieldShape = {
  id?: string;
  type: string;
  scope?: string;
  label: string;
  priceCents?: number;
};

/** The label the registration builder puts on a fee field's amount input. */
export const REGISTRATION_FEE_INPUT_LABEL = "Registration fee (standard price)";

/** A per-attendee fee field with no amount, and where to find it in the builder. */
export type UnpricedFeeField = { label: string; fieldId?: string; formId?: string };

/**
 * The per-attendee fee fields that have no amount: a CALCULATED attendee field
 * with no `priceCents`. The label is the field's own, so "Fall Camporee fee"
 * reads "Set the Fall Camporee fee". `fieldId` lets the warning link to it.
 */
export function unpricedFeeFields(
  definition: { sections: ReadonlyArray<{ fields: ReadonlyArray<FeeFieldShape> }> },
  formId?: string,
): UnpricedFeeField[] {
  return definition.sections
    .flatMap((section) => section.fields)
    .filter((field) => field.type === "CALCULATED" && field.scope === "ATTENDEE" && field.priceCents === undefined)
    .map((field) => ({ label: field.label, fieldId: field.id, formId }));
}

/** Labels of the unpriced fee fields (see `unpricedFeeFields`). */
export function unpricedFeeFieldLabels(definition: { sections: ReadonlyArray<{ fields: ReadonlyArray<FeeFieldShape> }> }) {
  return unpricedFeeFields(definition).map((field) => field.label);
}

/** The builder URL for one form's field; the builder opens that form and focuses the field's amount. */
export function registrationBuilderFieldHref(eventId: string, formId?: string, fieldId?: string) {
  const query = new URLSearchParams({ event: eventId });
  if (formId && fieldId) {
    query.set("form", formId);
    query.set("field", fieldId);
  }
  return `/registration-builder?${query.toString()}`;
}

/**
 * One warning per unpriced fee field, naming the exact place to set it (#617).
 * Plain strings (labels only) are accepted for callers with no builder context;
 * with an `eventId` the warning also links straight to the field.
 */
export function getFeeWarnings(unpriced: ReadonlyArray<string | UnpricedFeeField>, eventId?: string): EventReadinessWarning[] {
  const fields = unpriced.map((entry) => (typeof entry === "string" ? { label: entry } : entry));
  const seen = new Set<string>();
  return fields.flatMap((field) => {
    if (seen.has(field.label)) return [];
    seen.add(field.label);
    return [{
      id: `fee:${field.label}`,
      label: `Set the ${field.label}`,
      detail: `No amount is set. Open the registration builder \u2192 ${field.label} \u2192 set the amount in the "${REGISTRATION_FEE_INPUT_LABEL}" box, shown as soon as the field is open, before publishing.`,
      ...(eventId ? { href: registrationBuilderFieldHref(eventId, field.formId, field.fieldId) } : {}),
    }];
  });
}

/**
 * A form that takes card payment on a church-billed event (#606): the public form refuses to submit
 * there, so say why up front. `formTitles` are the titles of the attached forms with payment enabled.
 */
export function getPaymentOnChurchBilledWarnings(
  billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE" | null | undefined,
  formTitles: readonly string[],
): EventReadinessWarning[] {
  if (billingMode !== "DEFERRED_ORGANIZATION_INVOICE") return [];
  return [...new Set(formTitles)].map((title) => ({
    id: `payment-on-church-billed:${title}`,
    label: `${title} collects payment on a church-billed event`,
    detail: "This event bills the church or organization later, so a form with card payment cannot be submitted. Turn payment off on the form, or change the event to attendee pay.",
  }));
}

/**
 * Two or more published forms sharing a public title and description (#720):
 * the public event page can't tell them apart. Pass only forms with a
 * published version; a draft or withdrawn form never counts.
 */
export function getDuplicatePublicFormWarnings(
  publishedForms: ReadonlyArray<{ title: string; description?: string | null }>,
  eventId?: string,
): EventReadinessWarning[] {
  return duplicatePublicFormGroups(publishedForms).map((group) => ({
    id: `duplicate-public-forms:${publicFormLookKey(group[0]!)}`,
    label: `${group.length} published forms are titled "${group[0]!.title}"`,
    detail: DUPLICATE_PUBLIC_FORMS_MESSAGE,
    ...(eventId ? { href: registrationBuilderFieldHref(eventId) } : {}),
  }));
}
