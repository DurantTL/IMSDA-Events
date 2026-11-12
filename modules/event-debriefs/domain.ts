import {
  addCalendarDays,
  projectSchedule,
  ScheduleProjectionError,
  type ScheduleProjection,
} from "@/modules/communications/scheduled-email-domain";

/**
 * The post-event debrief (#1679), the pure half: its names, its starter questions, who is asked and when it goes out. No
 * database and no clock (the caller passes `now`).
 *
 * WHEN. One invitation at 8:00 a.m. in the event's own time zone on the day after the event's last day, and one reminder
 * three days after that. Both are counted in calendar days in the event's zone (`projectSchedule`'s AFTER_EVENT_END), so
 * the 8:00 holds across a clock change, and a wall time the clocks skip is moved to the first moment after the jump.
 */

export const DEBRIEF_MODULE_KEY = "debrief" as const;

export const DEBRIEF_FORM_PURPOSES = ["DEBRIEF", "DIRECTOR_EVALUATION"] as const;
export type DebriefFormPurpose = (typeof DEBRIEF_FORM_PURPOSES)[number];

/** Used when an event has no usable zone. */
export const DEBRIEF_FALLBACK_TIME_ZONE = "America/Chicago";
export const DEBRIEF_SEND_LOCAL_TIME = "08:00";
export const DEBRIEF_INVITE_DAYS_AFTER = 1;
/** The reminder goes three days after the invitation. */
export const DEBRIEF_REMINDER_GAP_DAYS = 3;
export const DEBRIEF_REMINDER_DAYS_AFTER = DEBRIEF_INVITE_DAYS_AFTER + DEBRIEF_REMINDER_GAP_DAYS;

export const DEBRIEF_FORM_SLUGS: Record<DebriefFormPurpose, string> = {
  DEBRIEF: "debrief",
  DIRECTOR_EVALUATION: "director-evaluation",
};

export const DEBRIEF_FORM_TITLES: Record<DebriefFormPurpose, string> = {
  DEBRIEF: "Event debrief",
  DIRECTOR_EVALUATION: "Club director evaluation",
};

export function isDebriefFormPurpose(value: unknown): value is DebriefFormPurpose {
  return typeof value === "string" && (DEBRIEF_FORM_PURPOSES as readonly string[]).includes(value);
}

const question = (key: string, label: string) => ({
  id: `field_${key}`,
  key,
  label,
  helpText: "",
  type: "LONG_TEXT" as const,
  scope: "REGISTRATION" as const,
  required: false,
  options: [] as string[],
});

/** The starter questions, as an information form definition. Staff may edit them per event afterwards. */
export function starterDefinition(purpose: DebriefFormPurpose, eventName: string) {
  const isEvaluation = purpose === "DIRECTOR_EVALUATION";
  return {
    title: DEBRIEF_FORM_TITLES[purpose],
    description: isEvaluation
      ? `A short evaluation from the club directors of ${eventName}. Staff read the answers; they are not shared with other clubs.`
      : `A short look back at ${eventName}, while it is fresh. Staff read the answers; they are kept with the event for next year's planners.`,
    confirmationMessage: "Thank you. Your answers have been received.",
    sections: [{
      id: "section_questions",
      title: "Questions",
      description: "",
      fields: isEvaluation
        ? [
          question("went_well", "What went well for your club?"),
          question("do_better", "What should we do better?"),
          question("next_year", "What would help your club next year?"),
        ]
        : [
          question("went_well", "What went well?"),
          question("do_better", "What should we do better?"),
          question("next_year", "Ideas for next year?"),
        ],
    }],
  };
}

export type DebriefTimingFacts = { timezone: string | null | undefined; endsAt: Date };

function zoneOrFallback(timezone: string | null | undefined) {
  const zone = timezone?.trim() || DEBRIEF_FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEBRIEF_FALLBACK_TIME_ZONE;
  }
}

export type DebriefSchedule = { invite: ScheduleProjection; reminder: ScheduleProjection };

/** When the invitation and the reminder go out for an event. Throws `ScheduleProjectionError` only for an unusable date. */
export function debriefSchedule(event: DebriefTimingFacts): DebriefSchedule {
  const facts = { timezone: zoneOrFallback(event.timezone), startsAt: event.endsAt, endsAt: event.endsAt, registrationClosesOn: null };
  return {
    invite: projectSchedule({ trigger: "AFTER_EVENT_END", daysAfter: DEBRIEF_INVITE_DAYS_AFTER, localTime: DEBRIEF_SEND_LOCAL_TIME }, facts),
    reminder: projectSchedule({ trigger: "AFTER_EVENT_END", daysAfter: DEBRIEF_REMINDER_DAYS_AFTER, localTime: DEBRIEF_SEND_LOCAL_TIME }, facts),
  };
}

export { ScheduleProjectionError, addCalendarDays };

export type DebriefBatchKind = "INVITE" | "REMINDER";

export const DEBRIEF_BATCH_NAMES: Record<DebriefBatchKind, string> = {
  INVITE: "Debrief invitation",
  REMINDER: "Debrief reminder",
};

export const DEBRIEF_BATCH_TEMPLATE_KEYS = { INVITE: "EVENT_DEBRIEF_INVITE", REMINDER: "EVENT_DEBRIEF_REMINDER" } as const;

/** A stable id per event and kind, so switching on twice is the same batch. */
export function debriefBatchId(eventId: string, kind: DebriefBatchKind) {
  return `debrief-${kind.toLowerCase()}-${eventId}`;
}

/** One message per batch, person and form: sending twice for the same batch queues nothing new. */
export function debriefMessageKey(batchId: string, accountId: string, purpose: DebriefFormPurpose) {
  return `event-debrief:${batchId}:${accountId}:${purpose}`;
}

export type DebriefRecipient = { accountId: string; email: string; name: string };

/** Lower-cased, valid-looking and one per account: the order is by address so a run is the same every time. */
export function dedupeRecipients(rows: ReadonlyArray<{ accountId: string; email: string; name: string }>): DebriefRecipient[] {
  const byAccount = new Map<string, DebriefRecipient>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (!byAccount.has(row.accountId)) byAccount.set(row.accountId, { accountId: row.accountId, email, name: row.name.trim() });
  }
  return [...byAccount.values()].sort((a, b) => a.email.localeCompare(b.email) || a.accountId.localeCompare(b.accountId));
}

/** Who is still to be reminded: the audience with those who already answered taken out. */
export function nonResponders(audience: readonly DebriefRecipient[], answeredAccountIds: ReadonlySet<string>): DebriefRecipient[] {
  return audience.filter((recipient) => !answeredAccountIds.has(recipient.accountId));
}

export function debriefFillPath(eventSlug: string, purpose: DebriefFormPurpose) {
  return `/events/${encodeURIComponent(eventSlug)}/forms/${encodeURIComponent(DEBRIEF_FORM_SLUGS[purpose])}`;
}

/**
 * The invitation or the reminder as plain text. It names the event and links to the form, and says the answers go to event
 * staff. It never carries a question or an answer.
 */
export function debriefEmailContent(input: { kind: DebriefBatchKind; purpose: DebriefFormPurpose; eventName: string; recipientName: string; url: string }) {
  const evaluation = input.purpose === "DIRECTOR_EVALUATION";
  const subject = input.kind === "REMINDER"
    ? `Reminder: ${evaluation ? "director evaluation" : "debrief"} for ${input.eventName}`
    : `${evaluation ? "Director evaluation" : "Debrief"} for ${input.eventName}`;
  const greeting = input.recipientName.trim() ? `Hello ${input.recipientName.trim()},` : "Hello,";
  const lines = [
    greeting,
    "",
    input.kind === "REMINDER"
      ? `A few days ago we asked for your short ${evaluation ? "evaluation" : "debrief"} of ${input.eventName}. We have not heard from you yet, and your answers help next year's planners.`
      : `${input.eventName} is over. While it is fresh, please take a few minutes to ${evaluation ? "evaluate it for your club" : "tell us what went well and what to do better"}.`,
    "",
    "Open it (you will be asked to sign in):",
    input.url,
    "",
    "Your answers are read by the event's staff and system administrators, and are kept with the event.",
    "",
    "IMAdventist",
  ];
  return { subject, bodyText: lines.join("\n") };
}
