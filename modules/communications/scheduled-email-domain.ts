import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Scheduled email batches (#177), the pure half: when a batch goes out, in the event's own time zone, and what it
 * means for a recipient to be "obsolete" by then. No database, no clock, no randomness (the caller passes `now`).
 *
 * TIME. A schedule is written as a wall-clock time in the event's time zone, never as a UTC instant, because staff think
 * "9:00 in the morning, a week before registration closes" and the event's zone is what its registrants live by. The
 * instant is derived here and the derivation is explicit about the two days a year it is not obvious:
 *
 *  - Spring forward: the wall time does not exist (02:30 when the clocks jump from 02:00 to 03:00). The email goes out at
 *    the first moment after the jump, the same offset the earlier part of the day used (so 02:30 becomes 03:30 local).
 *    `GAP_SHIFTED`.
 *  - Fall back: the wall time happens twice (01:30). The email goes out the first time it happens. `AMBIGUOUS_FIRST`.
 *
 * "N days before" counts calendar days in the event's zone, not blocks of 24 hours, so a 9:00 schedule stays at 9:00
 * local on both sides of a clock change.
 *
 * Anchors. EVENT_START is the event's start instant (its calendar date in the event's zone is the anchor day).
 * REGISTRATION_CLOSE is the event's `registrationClosesOn` calendar day: registration is open through that whole day
 * (see `evaluateEventRegistrationPhase`), so the close instant is local midnight at the end of it. PAYMENT_DUE (#993) is
 * the event's `paymentDueOn` calendar day, treated the same way: "due by" a day means through that whole day, so it is
 * past due at local midnight at the end of it. The date only anchors the count; it has no other effect (no late fee,
 * nothing blocked). A batch counted from it goes only to registrations that still owe a balance when it sends.
 * A schedule against an event with no due date is refused rather than guessed.
 */

import {
  SCHEDULED_EMAIL_STATUSES,
  SCHEDULED_EMAIL_STATUS_LABELS,
  SCHEDULED_EMAIL_TEMPLATE_KEYS,
  SCHEDULED_EMAIL_TEMPLATE_LABELS,
  SCHEDULED_EMAIL_TRIGGERS,
  SCHEDULED_EMAIL_TRIGGER_LABELS,
  type ScheduledEmailStatus,
  type ScheduledEmailTemplateKey,
  type ScheduledEmailTrigger,
} from "@/modules/communications/scheduled-email-options";
import { formatInTimeZone } from "@/modules/calendar/conference-format";

export {
  SCHEDULED_EMAIL_STATUSES,
  SCHEDULED_EMAIL_STATUS_LABELS,
  SCHEDULED_EMAIL_TEMPLATE_KEYS,
  SCHEDULED_EMAIL_TEMPLATE_LABELS,
  SCHEDULED_EMAIL_TRIGGERS,
  SCHEDULED_EMAIL_TRIGGER_LABELS,
  type ScheduledEmailStatus,
  type ScheduledEmailTemplateKey,
  type ScheduledEmailTrigger,
};

/** A schedule more than this late is not sent: a reminder that arrives a day after its moment is wrong, not late. */
export const SCHEDULED_EMAIL_MAX_LATE_MS = 6 * 60 * 60 * 1000;
/** The earliest a schedule may be set to, so a person has time to cancel what they just approved. */
export const SCHEDULED_EMAIL_MIN_LEAD_MS = 5 * 60 * 1000;
/** A claim older than this belongs to a worker that stopped; another worker may take it over (sends are idempotent). */
export const SCHEDULED_EMAIL_STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * A claim whose worker stopped with recipients still to queue (#1378). A batch that has queued everyone and is only
 * waiting on delivery is working normally, so it never matches.
 */
export function scheduledEmailAbandonedClaimWhere(now: Date) {
  return {
    claimedAt: { lt: new Date(now.getTime() - SCHEDULED_EMAIL_STALE_CLAIM_MS) },
    recipients: { some: { status: "PLANNED" as const } },
  };
}

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date in YYYY-MM-DD form.").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time in HH:MM form.");

export const scheduleRuleSchema = z.discriminatedUnion("trigger", [
  z.strictObject({
    trigger: z.literal("ONE_TIME"),
    localDate: calendarDateSchema,
    localTime: localTimeSchema,
  }),
  z.strictObject({
    trigger: z.literal("BEFORE_REGISTRATION_CLOSE"),
    daysBefore: z.number().int().min(0).max(365),
    localTime: localTimeSchema,
  }),
  z.strictObject({
    trigger: z.literal("BEFORE_EVENT_START"),
    daysBefore: z.number().int().min(0).max(365),
    localTime: localTimeSchema,
  }),
  z.strictObject({
    trigger: z.literal("BEFORE_PAYMENT_DUE"),
    daysBefore: z.number().int().min(0).max(365),
    localTime: localTimeSchema,
  }),
]);
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

export class ScheduleProjectionError extends Error {
  readonly code = "SCHEDULE_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "ScheduleProjectionError";
  }
}

export type DstBehavior = "NONE" | "GAP_SHIFTED" | "AMBIGUOUS_FIRST";

type ZoneParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function partsInZone(instantMs: number, timeZone: string): ZoneParts {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

/** The zone's offset from UTC at an instant, in milliseconds (negative west of Greenwich). */
export function zoneOffsetMs(instantMs: number, timeZone: string) {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const parts = partsInZone(whole, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - whole;
}

export function assertValidTimeZone(timeZone: string) {
  try {
    zoneFormatter(timeZone);
  } catch {
    throw new ScheduleProjectionError("The event's time zone is not recognised, so its send time cannot be shown.");
  }
}

/**
 * Turns a wall-clock time in a zone into an instant, saying what a clock change did to it. Tries both offsets that
 * apply near that day: an offset is real when the zone actually has it at the instant it implies.
 */
export function wallTimeToInstant(
  wall: { date: string; time: string },
  timeZone: string,
): { instant: Date; behavior: DstBehavior } {
  assertValidTimeZone(timeZone);
  const [year, month, day] = wall.date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = wall.time.split(":").map(Number) as [number, number];
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const before = zoneOffsetMs(wallMs - 24 * 3_600_000, timeZone);
  const after = zoneOffsetMs(wallMs + 24 * 3_600_000, timeZone);
  const valid = [...new Set([before, after])]
    .filter((offset) => zoneOffsetMs(wallMs - offset, timeZone) === offset)
    .map((offset) => wallMs - offset)
    .sort((a, b) => a - b);
  if (valid.length === 0) {
    // The wall time was skipped. Use the offset in force before the jump, which lands just after it.
    return { instant: new Date(wallMs - before), behavior: "GAP_SHIFTED" };
  }
  return { instant: new Date(valid[0]!), behavior: valid.length > 1 ? "AMBIGUOUS_FIRST" : "NONE" };
}

export function calendarDateInZone(instant: Date, timeZone: string) {
  const parts = partsInZone(instant.getTime(), timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Calendar arithmetic on a YYYY-MM-DD date: independent of any zone, so it never drifts across a clock change. */
export function addCalendarDays(date: string, days: number) {
  const moment = new Date(`${date}T00:00:00.000Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

export type ScheduleEventFacts = {
  timezone: string;
  startsAt: Date;
  /** `Event.registrationClosesOn`: the last calendar day registration is open, or null. */
  registrationClosesOn: string | null;
  /** `Event.paymentDueOn` (#993): the calendar day balances are due by, or null. */
  paymentDueOn?: string | null;
};

export type ScheduleProjection = {
  /** The instant the batch is sent. */
  sendAt: Date;
  /** The anchor instant a relative rule counts back from, or null for a one-time schedule. */
  anchorAt: Date | null;
  eventTimezone: string;
  /** The calendar date and time the batch goes out in the event's zone, after any clock change. */
  localDate: string;
  localTime: string;
  dstBehavior: DstBehavior;
  /** One plain sentence for the review screen. */
  dstNote: string;
  /** Staff-facing time, in the event's zone, with its zone abbreviation. */
  sendAtLabel: string;
};

export function formatInstantInZone(instant: Date, timeZone: string) {
  return formatInTimeZone(instant, timeZone, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function dstNoteFor(behavior: DstBehavior, requested: { date: string; time: string }, actual: Date, timeZone: string) {
  if (behavior === "GAP_SHIFTED") {
    return `${requested.time} does not exist on ${requested.date} in ${timeZone}: the clocks skip forward that day. The email goes out at the first moment after the change, ${formatInstantInZone(actual, timeZone)}.`;
  }
  if (behavior === "AMBIGUOUS_FIRST") {
    return `${requested.time} happens twice on ${requested.date} in ${timeZone}: the clocks go back that day. The email goes out the first time it happens, ${formatInstantInZone(actual, timeZone)}.`;
  }
  return "No daylight saving change affects this time. Days are counted as calendar days in the event's time zone, so the time of day stays the same across a clock change.";
}

/**
 * The instant a rule sends at, for an event, with the DST outcome. Refuses a rule that cannot be projected (no
 * registration close date, a send time after its own anchor); it does not check the time against the clock, which is
 * `assertSendTimeUsable`'s job, because a schedule that has passed is a different problem from one that cannot exist.
 */
export function projectSchedule(rule: ScheduleRule, event: ScheduleEventFacts): ScheduleProjection {
  assertValidTimeZone(event.timezone);
  let sendDate: string;
  let anchorAt: Date | null = null;
  if (rule.trigger === "ONE_TIME") {
    sendDate = rule.localDate;
  } else if (rule.trigger === "BEFORE_EVENT_START") {
    anchorAt = event.startsAt;
    sendDate = addCalendarDays(calendarDateInZone(event.startsAt, event.timezone), -rule.daysBefore);
  } else if (rule.trigger === "BEFORE_PAYMENT_DUE") {
    if (!event.paymentDueOn) {
      throw new ScheduleProjectionError("This event has no payment due date, so a schedule cannot count back from it. Set one in Event settings, or choose another trigger.");
    }
    // Due "by" a day means through the whole day, so it is past due at the end of it.
    anchorAt = wallTimeToInstant({ date: addCalendarDays(event.paymentDueOn, 1), time: "00:00" }, event.timezone).instant;
    sendDate = addCalendarDays(event.paymentDueOn, -rule.daysBefore);
  } else {
    if (!event.registrationClosesOn) {
      throw new ScheduleProjectionError("This event has no registration close date, so a schedule cannot count back from it. Set one in Event settings, or choose another trigger.");
    }
    // Registration is open through the whole closing day, so it closes at the end of it.
    anchorAt = wallTimeToInstant({ date: addCalendarDays(event.registrationClosesOn, 1), time: "00:00" }, event.timezone).instant;
    sendDate = addCalendarDays(event.registrationClosesOn, -rule.daysBefore);
  }
  const { instant, behavior } = wallTimeToInstant({ date: sendDate, time: rule.localTime }, event.timezone);
  if (anchorAt && instant.getTime() >= anchorAt.getTime()) {
    throw new ScheduleProjectionError(
      rule.trigger === "BEFORE_EVENT_START"
        ? "That time is after the event starts. Choose an earlier time or more days before."
        : rule.trigger === "BEFORE_PAYMENT_DUE"
          ? "That time is after payment is due. Choose an earlier time or more days before."
          : "That time is after registration closes. Choose an earlier time or more days before.",
    );
  }
  const actual = partsInZone(instant.getTime(), event.timezone);
  return {
    sendAt: instant,
    anchorAt,
    eventTimezone: event.timezone,
    localDate: calendarDateInZone(instant, event.timezone),
    localTime: `${String(actual.hour).padStart(2, "0")}:${String(actual.minute).padStart(2, "0")}`,
    dstBehavior: behavior,
    dstNote: dstNoteFor(behavior, { date: sendDate, time: rule.localTime }, instant, event.timezone),
    sendAtLabel: formatInstantInZone(instant, event.timezone),
  };
}

/** A projected time must still be ahead, by enough for a person to cancel what they approved. */
export function assertSendTimeUsable(sendAt: Date, now: Date) {
  if (sendAt.getTime() < now.getTime() + SCHEDULED_EMAIL_MIN_LEAD_MS) {
    throw new ScheduleProjectionError("That send time has passed or is too close to now. Choose a time at least five minutes from now.");
  }
}

/** The rule as stored columns, and back, so a stored batch is projected by the same code that reviewed it. */
export function ruleToColumns(rule: ScheduleRule) {
  return rule.trigger === "ONE_TIME"
    ? { trigger: rule.trigger, localDate: rule.localDate, localTime: rule.localTime, daysBefore: null }
    : { trigger: rule.trigger, localDate: null, localTime: rule.localTime, daysBefore: rule.daysBefore };
}

export function ruleFromColumns(row: { trigger: ScheduledEmailTrigger; localDate: string | null; localTime: string; daysBefore: number | null }): ScheduleRule {
  return row.trigger === "ONE_TIME"
    ? { trigger: "ONE_TIME", localDate: row.localDate ?? "", localTime: row.localTime }
    : { trigger: row.trigger, daysBefore: row.daysBefore ?? 0, localTime: row.localTime };
}

/**
 * Has what the schedule was reviewed against moved? The event's zone or its anchor instant changing means the projected
 * time shown to the approver is no longer the time it would send, so the schedule is paused for a new review rather
 * than sent at a time nobody approved.
 */
export function eventTimingChanged(
  stored: { eventTimezone: string; anchorAt: Date | null; sendAt: Date },
  current: ScheduleProjection,
) {
  return stored.eventTimezone !== current.eventTimezone
    || (stored.anchorAt?.getTime() ?? null) !== (current.anchorAt?.getTime() ?? null)
    || stored.sendAt.getTime() !== current.sendAt.getTime();
}

const TRANSITIONS: Record<ScheduledEmailStatus, readonly ScheduledEmailStatus[]> = {
  SCHEDULED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "CANCELLED", "COMPLETED", "FAILED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
  COMPLETED: [],
  FAILED: [],
};

export function canTransitionSchedule(from: ScheduledEmailStatus, to: ScheduledEmailStatus) {
  return TRANSITIONS[from].includes(to);
}

/**
 * A schedule can be edited until a send has begun (the caller also refuses a claimed one). Editing an approved schedule
 * withdraws the approval: it goes back to SCHEDULED and must be reviewed and approved again.
 */
export function canEditSchedule(status: ScheduledEmailStatus) {
  return status === "SCHEDULED" || status === "PAUSED" || status === "ACTIVE";
}

/* ------------------------------------------------------------------------------------------------------------------
 * Recipients: who is still eligible when the batch actually goes out.
 * ---------------------------------------------------------------------------------------------------------------- */

/** Why a reviewed recipient was dropped at send time. Codes only: no address, name or amount. */
export const SCHEDULE_EXCLUSION_LABELS = {
  REGISTRATION_NOT_FOUND: "The registration is no longer on this event",
  REGISTRATION_NOT_ACTIVE: "The registration was cancelled, withdrawn or is no longer submitted or confirmed",
  ADDRESS_CHANGED: "The registration's contact changed (a transfer or edit), so the reviewed address no longer applies",
  NO_LONGER_MATCHES: "The registration no longer matches the audience that was approved",
  NO_BALANCE_DUE: "No balance is due any more",
  ORGANIZATION_BILLED: "The event bills the responsible organization, not the attendee",
  NO_EMAIL: "No email address on file",
  INVALID_EMAIL: "Email address is not valid",
  OPTED_OUT_EVENT: "Opted out of this event's announcements",
  OPTED_OUT_ALL: "Opted out of all announcements",
  PROVIDER_BOUNCED: "The last email to this address bounced",
  PROVIDER_COMPLAINED: "The last email to this address was marked as spam",
  MINOR_RECIPIENT: "Youth are not sent scheduled email, so a minor's own address is never used",
  AGE_UNKNOWN_RECIPIENT: "Age unknown (no attendee type)",
  AGE_UNKNOWN_NO_RANGE: "Age unknown (attendee type has no adult age range)",
  APPROVER_NOT_PERMITTED: "The person who approved this schedule no longer has permission to send it",
  SCHEDULE_NOT_ACTIVE: "The schedule was paused or cancelled before this was sent",
  SCHEDULE_TOO_LATE: "It was not sent within six hours of its scheduled time, so it was not sent at all",
  FILTER_UNAVAILABLE: "A filter this schedule uses is no longer available (it changed, the audience grew too large, or the approver lost permission to use it)",
  ANCHOR_PASSED: "The moment it was counting back from (registration close, payment due date or event start) has passed",
  CONTACT_CHECK_FAILED: "Eligibility could not be confirmed, so nothing was sent",
} as const;
export type ScheduleExclusionCode = keyof typeof SCHEDULE_EXCLUSION_LABELS;

export type ReviewedRecipient = {
  registrationId: string;
  email: string;
  roles: readonly string[];
};

export type CurrentAudienceView = {
  /** Current eligible message targets: `${email}\u0000${registrationId}` to that target's balance and roles. */
  targets: ReadonlyMap<string, { balanceCents: number; roles: readonly string[] }>;
  /** Current registration state for those no longer targets, by registration id (absent = not on the event). */
  registrations: ReadonlyMap<string, { active: boolean }>;
  /** Exclusion codes the audience builder gave an address (suppression, no or invalid address, minor). */
  exclusionByEmail: ReadonlyMap<string, ScheduleExclusionCode>;
  /** Registration ids that still have some other current target (their contact moved to another address). */
  registrationsWithOtherTarget: ReadonlySet<string>;
  /**
   * Targets the independent youth check refused: the address is reachable only as an attendee, and no adult-type
   * attendee of that registration holds it. Decided from the attendee's type (never a birth date), separately from the
   * audience builder, so a recipient is never sent to on one rule's say-so alone.
   */
  minorTargets: ReadonlySet<string>;
  /** The subset of `minorTargets` refused only because the age is unknown, not because a known minor is behind it. */
  unknownAgeTargets?: ReadonlySet<string>;
  /** The subset of `unknownAgeTargets` where every attendee behind it has a type, but one with no adult age range. */
  unknownNoRangeTargets?: ReadonlySet<string>;
  /** The event bills the organization, so a balance reminder is never sent to an attendee. */
  isOrganizationBilled: boolean;
};

export function targetKey(email: string, registrationId: string) {
  return `${email.trim().toLowerCase()}\u0000${registrationId}`;
}

/**
 * Decides, for one reviewed recipient, whether to send now and if not, why. The order is the order a person would
 * explain it in: the registration, then the address, then the rules of the message, then the address's own state.
 * `null` means send.
 */
export function decideRecipientEligibility(
  recipient: ReviewedRecipient,
  template: ScheduledEmailTemplateKey,
  view: CurrentAudienceView,
  trigger: ScheduledEmailTrigger,
): ScheduleExclusionCode | null {
  const email = recipient.email.trim().toLowerCase();
  const registration = view.registrations.get(recipient.registrationId);
  if (!registration) return "REGISTRATION_NOT_FOUND";
  if (!registration.active) return "REGISTRATION_NOT_ACTIVE";
  // Youth never receive these. Checked before the audience's own answer, so an attendee who is now a minor is named as one
  // rather than as "no longer matches", and so the rule holds even if the audience were ever to list the address.
  const youthKey = targetKey(email, recipient.registrationId);
  if (view.minorTargets.has(youthKey)) {
    if (view.unknownNoRangeTargets?.has(youthKey)) return "AGE_UNKNOWN_NO_RANGE";
    return view.unknownAgeTargets?.has(youthKey) ? "AGE_UNKNOWN_RECIPIENT" : "MINOR_RECIPIENT";
  }
  const target = view.targets.get(targetKey(email, recipient.registrationId));
  if (!target) {
    const fromBuilder = view.exclusionByEmail.get(email);
    if (fromBuilder) return fromBuilder;
    if (view.registrationsWithOtherTarget.has(recipient.registrationId)) return "ADDRESS_CHANGED";
    return "NO_LONGER_MATCHES";
  }
  // A batch counted back from the payment due date (#993) is for people who still owe, whatever it says: decided now, from
  // the balance as it stands at send time, the same one the balance reminder uses.
  if (template === "BALANCE_REMINDER" || trigger === "BEFORE_PAYMENT_DUE") {
    if (view.isOrganizationBilled) return "ORGANIZATION_BILLED";
    if (target.balanceCents <= 0) return "NO_BALANCE_DUE";
  }
  return null;
}

export type ScheduleReviewTotals = { eligible: number; excluded: number; excludedByCode: Partial<Record<string, number>> };

/**
 * The review fingerprint an approver signs off on: the audience the builder fingerprinted, the template version and
 * content, the rule and its projected instant, and the delivery mode. Approving a different thing than was shown is
 * refused (PREVIEW_CHANGED), exactly as the other reviewed batches are.
 */
export function scheduleReviewFingerprint(input: {
  eventId: string;
  audienceFingerprint: string;
  queryHash: string;
  templateKey: ScheduledEmailTemplateKey;
  templateVersionId: string | null;
  announcementTitle: string;
  announcementBody: string;
  deliveryMode: string;
  rule: ScheduleRule;
  sendAt: Date;
  eventTimezone: string;
  targetKeys: readonly string[];
}) {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    ...input,
    sendAt: input.sendAt.toISOString(),
    targetKeys: [...input.targetKeys].sort(),
  })).digest("hex");
}

const contentShape = {
  name: z.string().trim().min(1, "Give the schedule a name.").max(120),
  templateKey: z.enum(SCHEDULED_EMAIL_TEMPLATE_KEYS),
  announcementTitle: z.string().trim().max(120).default(""),
  announcementBody: z.string().trim().max(4_000).default(""),
  rule: scheduleRuleSchema,
  query: z.unknown(),
};

function requireAnnouncementText(
  value: { templateKey: string; announcementTitle: string; announcementBody: string },
  context: z.RefinementCtx,
) {
  if (value.templateKey !== "EVENT_ANNOUNCEMENT") return;
  if (!value.announcementTitle) context.addIssue({ code: "custom", path: ["announcementTitle"], message: "An announcement needs a title." });
  if (!value.announcementBody) context.addIssue({ code: "custom", path: ["announcementBody"], message: "An announcement needs a message." });
}

/** What staff write: a name, the message, the timing rule and the audience query. Preview and review take exactly this. */
export const scheduledEmailContentSchema = z.strictObject(contentShape).superRefine(requireAnnouncementText);
export type ScheduledEmailContent = z.infer<typeof scheduledEmailContentSchema>;

/** Saving: the content, a client UUID (a retried request is the same schedule) and the review fingerprint that was shown. */
export const scheduledEmailCreateSchema = z.strictObject({
  scheduleId: z.uuid(),
  previewFingerprint: z.string().trim().length(64),
  ...contentShape,
}).superRefine(requireAnnouncementText);

/** Editing a schedule that has not started: the revision that was on screen, so two editors cannot overwrite each other. */
export const scheduledEmailUpdateSchema = z.strictObject({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().min(1),
  previewFingerprint: z.string().trim().length(64),
  ...contentShape,
}).superRefine(requireAnnouncementText);

/** Approving: the revision and the review fingerprint the approver was shown. Approval is always a person's own request. */
export const scheduledEmailActivateSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  previewFingerprint: z.string().trim().length(64),
});

/* ------------------------------------------------------------------------------------------------------------------
 * Youth: when an address that is a minor's may still be written to.
 * ---------------------------------------------------------------------------------------------------------------- */

export type YouthCheckRegistration = {
  registrationId: string;
  accountHolderPersonId: string;
  /** Normalized; the account holder's own address. */
  holderEmail: string;
  /** Normalized; the address typed as the registration contact, or "" when the contact falls back to the account holder. */
  snapshotEmail: string;
  /** This registration's attendees. Age class comes from the attendee type only, never a birth date (ADR 0005 Addendum A). */
  attendees: ReadonlyArray<{ personId: string; email: string; age: "ADULT" | "MINOR" | "UNKNOWN"; /** True when the attendee has an attendee type (so an UNKNOWN age means the type has no adult range). Omitted reads as untyped. */ typed?: boolean }>;
};

/** Everyone in the WHOLE event who is a non-adult attendee (minor or age unknown) on any registration, built once per evaluation. */
export type EventMinors = {
  personIds: ReadonlySet<string>;
  emails: ReadonlySet<string>;
  /** The subset whose attendee type says they are a minor (not merely unknown). Omitted means none is known. */
  knownMinorPersonIds?: ReadonlySet<string>;
  knownMinorEmails?: ReadonlySet<string>;
  /** The subset with no attendee type at all. Omitted means the caller cannot tell, so an unknown age reads as untyped. */
  untypedPersonIds?: ReadonlySet<string>;
  untypedEmails?: ReadonlySet<string>;
};

/** Why a youth target is refused: a known minor is behind it, or only an unknown age. */
export type YouthRefusalReason = "MINOR" | "UNKNOWN" | "UNKNOWN_NO_RANGE";

/**
 * Owner decision (#177, Oct 17, 2026): a youth's own address may receive a scheduled email only when an ADULT is genuinely
 * behind it in that send. Pure.
 *
 * - An address is a youth's when it is the own address of any minor or age-unknown attendee anywhere in the event, or the
 *   contact address (typed, or the fallback to the account holder) of a registration whose account holder is a minor.
 * - The account holder is judged across the whole event: a Person who is a non-adult attendee on ANY registration is a
 *   minor. A holder who attends nothing in the event is an adult parent (the normal case) and is not blocked.
 * - What vouches for a youth address: a group billing or organization contact (by the role the recipient holds NOW), the
 *   registration contact when the account holder is not a minor, or an adult-type attendee of this registration holding it.
 *   A minor account holder never vouches, so a youth who types a younger sibling's address stays refused.
 * - Any other address reached only as an attendee still needs an adult-type attendee holding it.
 *
 * Returns the refused targets.
 */
export function refusedYouthTargets(
  targets: ReadonlyArray<{ email: string; registrationId: string; roles: readonly string[] }>,
  registrations: ReadonlyMap<string, YouthCheckRegistration>,
  eventMinors: EventMinors,
): Set<string> {
  return new Set(refusedYouthTargetReasons(targets, registrations, eventMinors).keys());
}

/**
 * The same rule as `refusedYouthTargets`, with the reason for each refusal: MINOR when an attendee type says a minor is
 * behind the address, UNKNOWN when it is refused only because an attendee has no type (or no usable age range). The refused
 * set is identical; only the label differs.
 */
export function refusedYouthTargetReasons(
  targets: ReadonlyArray<{ email: string; registrationId: string; roles: readonly string[] }>,
  registrations: ReadonlyMap<string, YouthCheckRegistration>,
  eventMinors: EventMinors,
): Map<string, YouthRefusalReason> {
  const refused = new Map<string, YouthRefusalReason>();
  for (const target of targets) {
    const email = target.email.trim().toLowerCase();
    const registration = registrations.get(target.registrationId);
    // Not on this event any more: the registration check names that, and nothing here may vouch for the address.
    if (!registration) continue;
    const key = targetKey(email, target.registrationId);
    const holderIsMinor = eventMinors.personIds.has(registration.accountHolderPersonId)
      || registration.attendees.some((attendee) => attendee.personId === registration.accountHolderPersonId && attendee.age !== "ADULT");
    const contactEmail = registration.snapshotEmail || registration.holderEmail;
    const youthAddresses = new Set(eventMinors.emails);
    for (const attendee of registration.attendees) if (attendee.age !== "ADULT" && attendee.email) youthAddresses.add(attendee.email);
    if (holderIsMinor && contactEmail) youthAddresses.add(contactEmail);
    // A Person who is a minor anywhere in the event is a minor here too, even on a row typed as adult.
    const adultAttendeeHoldsIt = registration.attendees.some((attendee) =>
      attendee.age === "ADULT" && !eventMinors.personIds.has(attendee.personId) && attendee.email === email);
    const adultBehindIt = target.roles.some((role) => role === "GROUP_LEADER" || role === "ORGANIZATION_CONTACT")
      || (target.roles.includes("REGISTRATION_CONTACT") && !holderIsMinor)
      || adultAttendeeHoldsIt;
    const holderKnownMinor = eventMinors.knownMinorPersonIds?.has(registration.accountHolderPersonId)
      || registration.attendees.some((attendee) => attendee.personId === registration.accountHolderPersonId && attendee.age === "MINOR");
    const knownMinorBehindIt = Boolean(eventMinors.knownMinorEmails?.has(email))
      || registration.attendees.some((attendee) => attendee.age === "MINOR" && attendee.email === email)
      || Boolean(holderKnownMinor && holderIsMinor && email === contactEmail);
    // An unknown age is "no range" only with positive evidence that every attendee behind the address has a type.
    const untypedBehindIt = !eventMinors.untypedEmails
      || eventMinors.untypedEmails.has(email)
      || registration.attendees.some((attendee) => attendee.age === "UNKNOWN" && attendee.typed !== true && attendee.email === email)
      || Boolean(holderIsMinor && email === contactEmail && (eventMinors.untypedPersonIds?.has(registration.accountHolderPersonId)
        || registration.attendees.some((attendee) => attendee.personId === registration.accountHolderPersonId && attendee.age === "UNKNOWN" && attendee.typed !== true)));
    const reason: YouthRefusalReason = knownMinorBehindIt ? "MINOR" : untypedBehindIt ? "UNKNOWN" : "UNKNOWN_NO_RANGE";
    if (youthAddresses.has(email)) {
      if (!adultBehindIt) refused.set(key, reason);
      continue;
    }
    if (target.roles.length > 0 && target.roles.every((role) => role === "ATTENDEE") && !adultAttendeeHoldsIt) refused.set(key, reason);
  }
  return refused;
}
