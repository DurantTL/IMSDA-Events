import { createHash } from "node:crypto";
import { z } from "zod";
import { isEmail } from "@/lib/field-validation";
import { effectiveLocationDates, evaluateLocationPhase, type LocationDateSource } from "@/modules/event-locations/domain";
import { evaluateEventRegistrationPhase, type EventLifecycleSource } from "@/modules/events/lifecycle";
import { closesRegistration, effectiveLifecycleState } from "@/modules/events/lifecycle-state";
import { timeZoneLongName } from "@/modules/calendar/conference-format";
import { neutralizePlaceholders } from "@/modules/invoices/delivery-domain";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { clubRegistrationPath } from "@/modules/club-registrations/roster-return";
import { localClockTime } from "@/modules/events/event-times";

/**
 * Reminders for an unsubmitted club registration (#164): the pure rules. When a reminder is due, whether it may go out
 * now, who it goes to and exactly what it says. No database, no clock and no secrets, so what the sweep decides, what
 * the delivery re-check decides and what the tests pin are the same functions.
 *
 * Only a club director's server-side draft (`ClubRegistrationDraft`) is reminded about. A public form's draft lives in
 * the browser (#161), so there is nothing on the server to remind. A draft is not a registration: the email says plainly
 * that the club is not registered until the registration is submitted.
 *
 * The email names the director, the club, the event, the close date (when there is one) and links to the club's own
 * registration page, which needs a sign-in, so the link is not a secret and no token is created or stored. It never
 * carries an answer, a person's name, a count of people, a team name or a form field name.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const CLUB_DRAFT_REMINDER_TEMPLATE_KEY = "CLUB_DRAFT_REMINDER";

/** Allowed ranges and defaults, in whole days (or whole reminders). */
export const CLUB_DRAFT_REMINDER_LIMITS = {
  firstAfterDays: { min: 1, max: 14, default: 2 },
  repeatEveryDays: { min: 1, max: 14, default: 3 },
  maxReminders: { min: 1, max: 3, default: 2 },
  staleAfterDays: { min: 7, max: 90, default: 30 },
} as const;

export type ClubDraftReminderPolicyValues = {
  enabled: boolean;
  firstAfterDays: number;
  repeatEveryDays: number;
  maxReminders: number;
  staleAfterDays: number;
};

/** No policy row means off. The numbers are what a first save starts from. */
export const DEFAULT_CLUB_DRAFT_REMINDER_POLICY: ClubDraftReminderPolicyValues = {
  enabled: false,
  firstAfterDays: CLUB_DRAFT_REMINDER_LIMITS.firstAfterDays.default,
  repeatEveryDays: CLUB_DRAFT_REMINDER_LIMITS.repeatEveryDays.default,
  maxReminders: CLUB_DRAFT_REMINDER_LIMITS.maxReminders.default,
  staleAfterDays: CLUB_DRAFT_REMINDER_LIMITS.staleAfterDays.default,
};

const wholeNumber = (key: keyof typeof CLUB_DRAFT_REMINDER_LIMITS, label: string) => {
  const { min, max } = CLUB_DRAFT_REMINDER_LIMITS[key];
  return z.number({ error: `${label} must be a whole number from ${min} to ${max}.` })
    .int(`${label} must be a whole number from ${min} to ${max}.`)
    .min(min, `${label} must be a whole number from ${min} to ${max}.`)
    .max(max, `${label} must be a whole number from ${min} to ${max}.`);
};

/** What staff may save. Strict: an unknown field is refused. */
export const clubDraftReminderPolicySchema = z.object({
  enabled: z.boolean(),
  firstAfterDays: wholeNumber("firstAfterDays", "Days before the first reminder"),
  repeatEveryDays: wholeNumber("repeatEveryDays", "Days between reminders"),
  maxReminders: wholeNumber("maxReminders", "Number of reminders"),
  staleAfterDays: wholeNumber("staleAfterDays", "Days until a draft expires"),
}).strict().refine((value) => value.staleAfterDays > value.firstAfterDays, {
  path: ["staleAfterDays"],
  message: "A draft must expire after the first reminder is due, or it would never be reminded.",
});

type PolicyRow = Partial<ClubDraftReminderPolicyValues> | null | undefined;

/** The policy a row means, with defaults for anything missing. No row is off. */
export function policyFromRow(row: PolicyRow): ClubDraftReminderPolicyValues {
  return { ...DEFAULT_CLUB_DRAFT_REMINDER_POLICY, ...(row ?? {}) };
}

// --- When it may go out -------------------------------------------------------------------------------------------

/** Reminders go out only from this hour (inclusive) to that hour (exclusive), by the clock where the event is held. */
export const QUIET_HOURS = { sendFromHour: 9, sendUntilHour: 19 } as const;

function localHour(instant: Date, timeZone: string) {
  return Number(localClockTime(instant, timeZone).slice(0, 2));
}

/** Whether it is a reasonable hour to email, in the event's own time zone: 9:00 up to (not including) 19:00. */
export function isWithinSendHours(now: Date, timeZone: string) {
  const hour = localHour(now, timeZone);
  return hour >= QUIET_HOURS.sendFromHour && hour < QUIET_HOURS.sendUntilHour;
}

/** "9 a.m. to 7 p.m. Central": the send hours as a person reads them, in the event's own zone. */
export function sendHoursLabel(timeZone: string) {
  const hour = (value: number) => (value < 12 ? `${value} a.m.` : `${value === 12 ? 12 : value - 12} p.m.`);
  // "Central Time" and "Mountain Standard Time" read as "Central" and "Mountain"; a zone with only a GMT offset for a name
  // (UTC) says "where the event is held" instead.
  const name = timeZoneLongName(timeZone).replace(/ Time$/, "").replace(/ Standard$/, "");
  const zone = /^(GMT|UTC)/.test(name) ? "where the event is held" : name;
  return `${hour(QUIET_HOURS.sendFromHour)} to ${hour(QUIET_HOURS.sendUntilHour)} ${zone}`;
}

/** The first moment from `now` that is inside the send hours: `now` itself, or the next 9 a.m. where the event is held. */
export function nextSendWindowStart(now: Date, timeZone: string) {
  if (isWithinSendHours(now, timeZone)) return now;
  const QUARTER = 15 * 60 * 1000;
  let probe = Math.ceil((now.getTime() + 1) / QUARTER) * QUARTER;
  for (let step = 0; step < 4 * 48; step += 1, probe += QUARTER) {
    if (localClockTime(new Date(probe), timeZone) === `${String(QUIET_HOURS.sendFromHour).padStart(2, "0")}:00`) return new Date(probe);
  }
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

export type DraftReminderEvent = Pick<EventLifecycleSource, "isPublished" | "timezone" | "registrationOpensOn" | "registrationClosesOn" | "waitlistEnabled" | "archivedAt" | "lifecycleState" | "lastDay"> & { startsAt: Date; endsAt: Date };

/** An active location of the event, with its own dates. */
export type DraftReminderLocation = LocationDateSource & { id: string };

/**
 * Whether a club may still submit this draft, and the closing date its messages may quote, by the rules the club's own
 * page uses (`clubPhase` and `quotedClosingDate`): a draft at a chosen active location that is open follows that
 * location's dates; a draft with no location, or one whose location is inactive or no longer open, is open while any
 * active location is (quoting the event's date), or by the event's own dates when it has none. A lifecycle state that closes registration closes it whatever the dates say, and no date is
 * then quoted. Judged in the event's own time zone.
 */
export function draftRegistrationWindow(
  event: DraftReminderEvent,
  activeLocations: readonly DraftReminderLocation[],
  draftLocationId: string | null,
  now: Date,
): { open: boolean; closesOn: string | null } {
  const picked = draftLocationId ? activeLocations.find((location) => location.id === draftLocationId) ?? null : null;
  // A chosen location that is no longer open does not close the draft: the club page then treats it as a draft with no
  // location and asks the director to choose another, so the same fallback applies here.
  const chosen = picked && evaluateLocationPhase(event, picked, now) === "OPEN" ? picked : null;
  const phase = chosen || activeLocations.length === 0
    ? evaluateLocationPhase(event, chosen, now)
    : activeLocations.some((location) => evaluateLocationPhase(event, location, now) === "OPEN") ? "OPEN" : "CLOSED";
  const closesOn = closesRegistration(effectiveLifecycleState(event)) ? null : effectiveLocationDates(event, chosen).registrationClosesOn;
  return { open: phase === "OPEN", closesOn };
}

/** Whether registration is open for the event itself, with no location in play. */
export function registrationIsOpen(event: DraftReminderEvent, now: Date) {
  return evaluateEventRegistrationPhase(event, now) === "OPEN";
}

// --- Which draft is due -------------------------------------------------------------------------------------------

export type ReminderDraft = { updatedAt: Date };
export type PriorReminder = { attempt: number; sentAt: Date };

export type ReminderDecision =
  | { due: true; attempt: number; dueAt: Date }
  | { due: false; reason: "OFF" | "CLOSED" | "STALE" | "MAX_REACHED" }
  | { due: false; reason: "NOT_YET"; attempt: number; dueAt: Date };

/** A draft not edited for longer than `staleAfterDays` counts as expired. */
export function draftIsStale(draft: ReminderDraft, staleAfterDays: number, now: Date) {
  return now.getTime() - draft.updatedAt.getTime() > staleAfterDays * DAY_MS;
}

/**
 * When the next reminder for a draft falls, ignoring whether it is stale or registration is closed: attempt 1 is
 * `firstAfterDays` after the draft was last edited. Attempt n after that is `repeatEveryDays` after the previous
 * reminder, unless the draft was edited since then, in which case the wait restarts from the edit. `null` when
 * `maxReminders` have already been sent.
 */
export function nextReminderSchedule(draft: ReminderDraft, policy: ClubDraftReminderPolicyValues, prior: readonly PriorReminder[]): { attempt: number; dueAt: Date } | null {
  const attempt = prior.reduce((highest, reminder) => Math.max(highest, reminder.attempt), 0) + 1;
  if (attempt > policy.maxReminders) return null;
  if (attempt === 1) return { attempt, dueAt: new Date(draft.updatedAt.getTime() + policy.firstAfterDays * DAY_MS) };
  const lastSent = prior.reduce((latest, reminder) => Math.max(latest, reminder.sentAt.getTime()), 0);
  const base = Math.max(lastSent, draft.updatedAt.getTime());
  return { attempt, dueAt: new Date(base + policy.repeatEveryDays * DAY_MS) };
}

/**
 * Whether a reminder is due for this draft at `now`, and which attempt it is. Never when the policy is off, when
 * registration is closed, when the draft is stale (expired), or beyond `maxReminders`. The send-hours rule is separate
 * (`isWithinSendHours`) because it is a property of the clock, not of the draft.
 */
export function nextReminderDue(
  draft: ReminderDraft,
  policy: ClubDraftReminderPolicyValues,
  prior: readonly PriorReminder[],
  now: Date,
  context: { registrationOpen: boolean },
): ReminderDecision {
  if (!policy.enabled) return { due: false, reason: "OFF" };
  if (!context.registrationOpen) return { due: false, reason: "CLOSED" };
  if (draftIsStale(draft, policy.staleAfterDays, now)) return { due: false, reason: "STALE" };
  const next = nextReminderSchedule(draft, policy, prior);
  if (!next) return { due: false, reason: "MAX_REACHED" };
  if (next.dueAt.getTime() > now.getTime()) return { due: false, reason: "NOT_YET", attempt: next.attempt, dueAt: next.dueAt };
  return { due: true, attempt: next.attempt, dueAt: next.dueAt };
}

// --- Who gets it --------------------------------------------------------------------------------------------------

export type ReminderGrant = {
  role: "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
  email: string | null | undefined;
  name: string;
};

export type ReminderRecipient = { email: string; name: string };

/** Directors and deputies only, with a usable address, one message per address (compared in lower case). */
export function draftReminderRecipients(grants: readonly ReminderGrant[]): ReminderRecipient[] {
  const seen = new Set<string>();
  const people: ReminderRecipient[] = [];
  for (const grant of grants) {
    if (grant.role !== "DIRECTOR" && grant.role !== "DEPUTY") continue;
    const email = (grant.email ?? "").trim().toLowerCase();
    if (!email || !isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    people.push({ email, name: grant.name });
  }
  return people.sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * One message per club run, address and set of drafts: the outbox key that makes a retried queueing a no-op. A club with
 * one draft keeps the plain `draft:attempt` form; a club with several drafts (teams) gets one key from the sorted draft
 * ids and attempts, stable however the list was ordered.
 */
export function draftReminderIdempotencyKey(drafts: ReadonlyArray<{ id: string; attempt: number }>, email: string) {
  const address = email.trim().toLowerCase();
  if (drafts.length === 1) return `club-draft-reminder:${drafts[0]!.id}:${drafts[0]!.attempt}:${address}`;
  const digest = createHash("sha256").update([...drafts].map((draft) => `${draft.id}:${draft.attempt}`).sort().join(",")).digest("hex").slice(0, 32);
  return `club-draft-reminder:group:${digest}:${address}`;
}

// --- What it says -------------------------------------------------------------------------------------------------

export function draftReminderUrl(baseUrl: string, organizationId: string, eventId: string) {
  return new URL(clubRegistrationPath(organizationId, eventId), baseUrl).toString();
}

/**
 * The reminder: the director's name, the club, the event, the close date when there is one, and a link to the club's
 * registration page. Nothing from the draft itself.
 */
export function draftReminderEmail(input: {
  directorName: string;
  clubName: string;
  eventName: string;
  registrationClosesOn: string | null;
  registrationUrl: string;
}) {
  const director = neutralizePlaceholders(input.directorName.trim());
  const club = neutralizePlaceholders(input.clubName.trim());
  const event = neutralizePlaceholders(input.eventName.trim());
  return {
    subject: `${club}: finish your registration for ${event}`,
    bodyText: [
      director ? `Hello ${director},` : "Hello,",
      "",
      `${club} has started a registration for ${event} but has not submitted it yet. The club is not registered until the registration is submitted.`,
      ...(input.registrationClosesOn ? ["", `Registration closes on ${formatCalendarDate(input.registrationClosesOn)}.`] : []),
      "",
      `Sign in and finish the registration: ${input.registrationUrl}`,
      "",
      "If you have already submitted it, or you no longer plan to attend, you can ignore this message.",
    ].join("\n"),
  };
}

/** Why a queued reminder was not sent, as recorded on the outbox row. */
export const CLUB_DRAFT_REMINDER_OBSOLETE_NOTE = "The draft was submitted, removed or expired, or reminders were turned off, so the reminder was not sent.";

/** What the staff settings section shows: the policy, whether email is on, and counts and dates only. */
export type ClubDraftReminderOverview = {
  policy: ClubDraftReminderPolicyValues;
  /** Whether the event's email really goes out; with it off, reminders are held. */
  emailOn: boolean;
  registrationOpen: boolean;
  /** The send hours as people read them, for the settings text. */
  sendHours: string;
  /** Counts only: how many unsubmitted club registrations there are, and what the forecast is for them. */
  drafts: number;
  /** Drafts that would get a reminder on the next run, if reminders were on. */
  dueNow: number;
  /** When the next reminders fall for drafts not due yet, soonest first, as ISO instants. */
  upcoming: string[];
  /** Reminders by outcome for this event. */
  counts: { queued: number; sent: number; failed: number; suppressed: number; cancelled: number };
  limits: { firstAfterDays: [number, number]; repeatEveryDays: [number, number]; maxReminders: [number, number]; staleAfterDays: [number, number] };
};

// --- Staff preview ------------------------------------------------------------------------------------------------

export type ReminderForecast = {
  /** Drafts that would get a reminder on the next run (the first one that falls in the send hours). */
  dueNow: number;
  /** When the next reminders fall for drafts not due yet, soonest first (at most `limit`). */
  upcoming: Date[];
};

/** The counts and dates behind the staff preview: no club, no person and no answer, only numbers and times. */
export function forecastReminders(
  drafts: ReadonlyArray<{ updatedAt: Date; prior: readonly PriorReminder[]; registrationOpen: boolean }>,
  policy: ClubDraftReminderPolicyValues,
  now: Date,
  limit = 3,
): ReminderForecast {
  let dueNow = 0;
  const upcoming: Date[] = [];
  for (const draft of drafts) {
    const decision = nextReminderDue(draft, policy, draft.prior, now, { registrationOpen: draft.registrationOpen });
    if (decision.due) dueNow += 1;
    else if (decision.reason === "NOT_YET" && !draftIsStale(draft, policy.staleAfterDays, decision.dueAt)) upcoming.push(decision.dueAt);
  }
  upcoming.sort((a, b) => a.getTime() - b.getTime());
  return { dueNow, upcoming: upcoming.slice(0, limit) };
}
