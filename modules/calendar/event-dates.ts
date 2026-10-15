/**
 * When a linked calendar item's dates differ from its registration event's
 * (#445): the banner's wording and the preview of what Update would change.
 * Pure. A date change is never applied by itself; staff choose Update or Keep.
 */
import { formatDateRange } from "@/modules/calendar/domain";

export type DateDecision = "update" | "keep";

export type DatePromptSource = {
  itemStartsOn: string;
  itemEndsOn: string;
  eventStartsOn: string;
  eventEndsOn: string;
  /**
   * The item's dates when they were last acknowledged: set when the item is linked (only if they matched the
   * event's then) and at every Update or Keep. Null while the item and event have differed since linking.
   */
  baselineStartsOn: string | null;
  baselineEndsOn: string | null;
};

/**
 * Whether the event should ask. The item's dates must differ from the event's, and must not be exactly the dates
 * staff already acknowledged: an event staff changed by hand while the item stayed put is not a question.
 */
export function datesNeedDecision(source: DatePromptSource) {
  if (source.itemStartsOn === source.eventStartsOn && source.itemEndsOn === source.eventEndsOn) return false;
  return !(source.baselineStartsOn === source.itemStartsOn && source.baselineEndsOn === source.itemEndsOn);
}

/** "moved" when the item left dates staff had acknowledged; "differs" when it never agreed with the event since linking. */
export function datePromptKind(source: Pick<DatePromptSource, "baselineStartsOn" | "baselineEndsOn">): "moved" | "differs" {
  return source.baselineStartsOn !== null && source.baselineEndsOn !== null ? "moved" : "differs";
}

/**
 * The banner's question. Moved from Google: "Google Calendar moved this event to November 7–9, 2026. Update the
 * registration dates?" An item that never matched its event says it differs instead.
 */
export function datePromptMessage(input: { imported: boolean; kind: "moved" | "differs"; itemStartsOn: string; itemEndsOn: string }) {
  const range = formatDateRange(input.itemStartsOn, input.itemEndsOn);
  if (input.kind === "differs") {
    return `The calendar item for this event shows ${range}, which differs from the registration dates. Update the registration dates?`;
  }
  return input.imported
    ? `Google Calendar moved this event to ${range}. Update the registration dates?`
    : `The calendar item for this event was moved to ${range}. Update the registration dates?`;
}

export type DependentDate = {
  label: string;
  /** The date or range as shown, e.g. "September 1, 2026". */
  value: string;
  /** True when, after the change, the date no longer makes sense against the new event dates. */
  needsAttention: boolean;
  note: string;
};

export type DatePreviewInput = {
  registrationOpensOn: string | null;
  registrationClosesOn: string | null;
  seminarPreferenceClosesOn: string | null;
  locations: Array<{ name: string; firstDay: string | null; lastDay: string | null; registrationClosesOn: string | null }>;
  lodging: { firstNight: string | null; lastNight: string | null; preferencesDeadline: string | null } | null;
  /** Dates of the event's active meal services. */
  mealServiceDates: string[];
  /** The last day of each window of the event's current cancellation policy. */
  cancellationWindows: Array<{ label: string; endsOn: string }>;
  /** Registrations that are submitted, confirmed or waitlisted. */
  registrationCount: number;
};

export type DatePreview = {
  /** What Update changes. */
  changes: Array<{ label: string; from: string; to: string }>;
  /** Dates that depend on the event's, which Update leaves exactly as they are. */
  unchanged: DependentDate[];
  /** Things staff should know before choosing, in a sentence each. */
  notes: string[];
  /** Why Update is refused until staff fix something first, or null. */
  blockedReason: string | null;
};

const day = (value: string) => formatDateRange(value, value);

/**
 * Update changes the event's first and last day and nothing else: registration
 * dates, deadlines, location windows, meals, the cancellation policy and prices
 * stay as staff set them, and the preview lists each with a flag when it no
 * longer fits. Opening registration after the event ends is refused outright,
 * because the event settings could not be saved afterward.
 */
export function buildDatePreview(
  event: { startsOn: string; endsOn: string } & DatePreviewInput,
  next: { startsOn: string; endsOn: string },
): DatePreview {
  const unchanged: DependentDate[] = [];
  const notes: string[] = [];
  let blockedReason: string | null = null;
  if (event.registrationOpensOn) {
    const after = event.registrationOpensOn > next.endsOn;
    unchanged.push({
      label: "Registration opens",
      value: day(event.registrationOpensOn),
      needsAttention: after,
      note: after ? "This is after the new last day. Change it in event settings before updating." : "",
    });
    if (after) blockedReason = "Registration is set to open after the new last day. Change the registration open date in event settings, then update the dates.";
  }
  if (event.registrationClosesOn) {
    const after = event.registrationClosesOn > next.endsOn;
    unchanged.push({
      label: "Registration closes",
      value: day(event.registrationClosesOn),
      needsAttention: after,
      note: after ? "This is after the new last day. Registration also closes when the event ends." : "",
    });
  }
  if (event.seminarPreferenceClosesOn) {
    const after = event.seminarPreferenceClosesOn > next.endsOn;
    unchanged.push({
      label: "Seminar preferences close",
      value: day(event.seminarPreferenceClosesOn),
      needsAttention: after,
      note: after ? "This is after the new last day." : "",
    });
  }
  for (const location of event.locations) {
    const outside = (location.firstDay !== null && location.firstDay > next.endsOn)
      || (location.lastDay !== null && location.lastDay < next.startsOn);
    if (location.firstDay || location.lastDay) {
      unchanged.push({
        label: `${location.name}: days`,
        value: formatDateRange(location.firstDay ?? location.lastDay ?? next.startsOn, location.lastDay ?? location.firstDay ?? next.endsOn),
        needsAttention: outside,
        note: outside ? "These days fall outside the new event dates." : "",
      });
    }
    if (location.registrationClosesOn) {
      unchanged.push({
        label: `${location.name}: registration closes`,
        value: day(location.registrationClosesOn),
        needsAttention: location.registrationClosesOn > next.endsOn,
        note: location.registrationClosesOn > next.endsOn ? "This is after the new last day." : "",
      });
    }
  }
  if (event.lodging) {
    if (event.lodging.firstNight || event.lodging.lastNight) {
      const first = event.lodging.firstNight ?? event.lodging.lastNight ?? next.startsOn;
      const last = event.lodging.lastNight ?? event.lodging.firstNight ?? next.endsOn;
      const outside = last < next.startsOn || first > next.endsOn;
      unchanged.push({ label: "Lodging nights", value: formatDateRange(first, last), needsAttention: outside, note: outside ? "These nights fall outside the new event dates." : "" });
    }
    if (event.lodging.preferencesDeadline) {
      const after = event.lodging.preferencesDeadline > next.endsOn;
      unchanged.push({ label: "Lodging preferences close", value: day(event.lodging.preferencesDeadline), needsAttention: after, note: after ? "This is after the new last day." : "" });
    }
  }
  if (event.mealServiceDates.length > 0) {
    const outside = [...new Set(event.mealServiceDates.filter((date) => date < next.startsOn || date > next.endsOn))].sort();
    unchanged.push({
      label: "Meal services",
      value: `${event.mealServiceDates.length} ${event.mealServiceDates.length === 1 ? "service" : "services"}`,
      needsAttention: outside.length > 0,
      note: outside.length > 0
        ? `${event.mealServiceDates.filter((date) => date < next.startsOn || date > next.endsOn).length} fall outside the new event dates (${outside.slice(0, 4).map(day).join("; ")}${outside.length > 4 ? "; and more" : ""}).`
        : "",
    });
  }
  for (const window of event.cancellationWindows) {
    const after = window.endsOn > next.endsOn;
    unchanged.push({
      label: `Cancellation window "${window.label}" ends`,
      value: day(window.endsOn),
      needsAttention: after,
      note: after ? "This is after the new last day." : "",
    });
  }
  if (event.registrationCount > 0) {
    notes.push(
      `This event has ${event.registrationCount} ${event.registrationCount === 1 ? "registration" : "registrations"}. Update changes none of them, and the people registered are not told. Whether someone is a minor is measured on the event's first day, so moving it can change who counts as a minor.`,
    );
  }
  return {
    changes: [{ label: "Event dates", from: formatDateRange(event.startsOn, event.endsOn), to: formatDateRange(next.startsOn, next.endsOn) }],
    unchanged,
    notes,
    blockedReason,
  };
}

/** Pricing deadlines live in each registration form's own wording, so they are never shifted; the preview says so. */
export const pricingDeadlineNote =
  "Prices and any deadline written into a registration form stay as they are. Review them after updating.";
