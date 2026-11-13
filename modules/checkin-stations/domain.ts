import { z } from "zod";
import type { EventPermission } from "@/modules/access/permissions";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";

/** The device cookie for a check-in station (#892). It is never read by any staff route. */
export const CHECK_IN_STATION_COOKIE_NAME = "imsda_check_in_station";

/** A station can be started this long before the event begins (setting up the desk the day before), never earlier. */
export const STATION_START_LEAD_MS = 2 * 24 * 60 * 60 * 1000;

/** `lastSeenAt` is only rewritten once a minute, like a staff session. */
export const STATION_TOUCH_INTERVAL_MS = 60 * 1000;

export const STATION_LABEL_MAX_LENGTH = 60;

/** Per station, per minute. A scanner types one code per arrival; this leaves room for a busy line and stops a script. */
export const STATION_LOOKUP_LIMIT_PER_MINUTE = 60;

export const stationLabelSchema = z.string().trim().max(STATION_LABEL_MAX_LENGTH).default("");

export const startStationSchema = z.strictObject({ label: stationLabelSchema });

export const STATION_INACTIVE_MESSAGE =
  "This station is not active. Ask a staff member to start it again from Check-in.";

export type StationStartProblem = "TOO_EARLY" | "EVENT_ENDED";

/**
 * When a station must stop: the end of the event's last calendar day in its own time zone. Event dates are stored as
 * noon UTC of the calendar day, so `endsAt` itself is the morning of the last day; the app treats an event as ended
 * only once that calendar day has passed (`hasEventEnded`). Pure; found by searching for the first instant whose
 * calendar date in the zone is after the last day.
 */
export function stationEndsAt(event: { endsAt: Date; timezone: string }): Date {
  const lastDay = calendarDateInEventTimeZone(event.endsAt, event.timezone);
  let low = event.endsAt.getTime();
  let high = low + 50 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (calendarDateInEventTimeZone(new Date(mid), event.timezone) > lastDay) high = mid;
    else low = mid;
  }
  return new Date(high);
}

/** Pure: whether a station may be started for this event right now. Null means it may. */
export function stationStartProblem(
  event: { startsAt: Date; endsAt: Date; timezone: string },
  now: Date,
): StationStartProblem | null {
  if (now.getTime() >= stationEndsAt(event).getTime()) return "EVENT_ENDED";
  if (now.getTime() < event.startsAt.getTime() - STATION_START_LEAD_MS) return "TOO_EARLY";
  return null;
}

export type StationInvalidReason =
  | "REVOKED"
  | "STOPPED"
  | "EXPIRED"
  | "STARTER_INACTIVE"
  | "PERMISSION_LOST"
  | "EVENT_MOVED";

export type StationRecordState = {
  expiresAt: Date;
  revokedAt: Date | null;
  stoppedAt: Date | null;
  /** True once the event's current dates say it is over (dates edited after the station started move this). */
  eventEnded?: boolean;
  /** True while the event's current start is more than the start lead away (it was moved later after the station started). */
  eventNotOpen?: boolean;
  starter: {
    accountStatus: string;
    hasCredential: boolean;
    credentialDisabledAt: Date | null;
  };
};

/**
 * Pure: why a station cannot be used, or null when it can. The starter checks mirror what the staff session loader
 * applies (an enabled credential and an ACTIVE account); `permissions` are the starter's permissions on the
 * station's event right now, so losing check-in access ends the station without anyone revoking it.
 */
export function stationInvalidReason(
  station: StationRecordState,
  permissions: readonly EventPermission[] | null,
  now: Date,
): StationInvalidReason | null {
  if (station.revokedAt) return "REVOKED";
  if (station.stoppedAt) return "STOPPED";
  if (station.expiresAt.getTime() <= now.getTime() || station.eventEnded) return "EXPIRED";
  if (station.eventNotOpen) return "EVENT_MOVED";
  if (
    !station.starter.hasCredential
    || station.starter.credentialDisabledAt
    || station.starter.accountStatus !== "ACTIVE"
  ) {
    return "STARTER_INACTIVE";
  }
  if (!permissions || !permissions.includes("MANAGE_CHECK_IN")) return "PERMISSION_LOST";
  return null;
}

export function shouldTouchStation(lastSeenAt: Date, now: Date) {
  return now.getTime() - lastSeenAt.getTime() >= STATION_TOUCH_INTERVAL_MS;
}

/** The cookie lasts exactly as long as the station: until the event ends. */
export function stationCookieOptions(expiresAt: Date, now: Date, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
    expires: expiresAt,
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

/** What a station may do, narrowed from its starter's permissions. */
export type StationCapabilities = {
  canCheckIn: boolean;
  /** Cash and check also need the finance permission; without it the payment form is not shown. */
  canRecordPayments: boolean;
};

export function stationCapabilities(permissions: readonly EventPermission[]): StationCapabilities {
  return {
    canCheckIn: permissions.includes("MANAGE_CHECK_IN"),
    canRecordPayments: permissions.includes("MANAGE_CHECK_IN") && permissions.includes("MANAGE_FINANCE"),
  };
}

export const stationLookupSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pass"), value: z.string().trim().min(1).max(768) }),
  z.strictObject({ kind: z.literal("confirmation"), value: z.string().trim().min(3).max(80) }),
]);

/**
 * What the scanner typed. A QR pass is a long dotted token; anything else is a confirmation code. A USB or
 * Bluetooth scanner types the text and presses Enter, so one text box serves both.
 */
export function classifyStationEntry(raw: string): z.infer<typeof stationLookupSchema> | null {
  const value = raw.trim();
  if (!value) return null;
  const looksLikePass = value.length >= 20 && value.includes(".") && !/\s/.test(value);
  return looksLikePass ? { kind: "pass", value } : { kind: "confirmation", value };
}

export const STATION_BALANCE_REASONS = [
  { code: "PAYING_LATER", label: "Paying later this event" },
  { code: "GROUP_WILL_PAY", label: "Church or group will pay" },
  { code: "SCHOLARSHIP_PENDING", label: "Scholarship or discount pending" },
  { code: "OTHER", label: "Other" },
] as const;

export type StationBalanceReasonCode = (typeof STATION_BALANCE_REASONS)[number]["code"];

export const STATION_BALANCE_NOTE_MAX_LENGTH = 300;

export const STATION_BALANCE_OTHER_NOTE_MESSAGE = "Add a short note explaining the reason.";

export function stationBalanceReasonLabel(code: StationBalanceReasonCode) {
  return STATION_BALANCE_REASONS.find((reason) => reason.code === code)?.label ?? "Other";
}

export const stationBalanceReasonSchema = z.strictObject({
  code: z.enum(STATION_BALANCE_REASONS.map((reason) => reason.code) as [StationBalanceReasonCode, ...StationBalanceReasonCode[]]),
  note: z.string().trim().max(STATION_BALANCE_NOTE_MAX_LENGTH).default(""),
}).refine((value) => value.code !== "OTHER" || value.note.length > 0, {
  path: ["note"],
  message: STATION_BALANCE_OTHER_NOTE_MESSAGE,
});

export type StationBalanceReason = z.infer<typeof stationBalanceReasonSchema>;

export const stationCheckInSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
  /** Required (checked on the server) only while the registration still has a balance due. */
  balanceReason: stationBalanceReasonSchema.optional(),
  items: z.array(z.strictObject({
    attendeeId: z.string().trim().min(1).max(100),
    idempotencyKey: z.uuid(),
  })).min(1).max(100),
});

export const stationUndoSchema = z.strictObject({
  attendeeId: z.string().trim().min(1).max(100),
});

/** One line per thing to give the family after a check-in: "Name badge × 2", "Cabin key K-204". */
export function stationBadgeLine(count: number) {
  return `Name badge × ${count}`;
}

export const stationPaymentSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
  method: z.enum(["CASH", "CHECK"]),
  amountCents: z.number().int().positive().max(10_000_000),
  checkNumber: z.string().trim().max(40).default(""),
  /** One per submission attempt of the payment form; kept across retries of that attempt. */
  idempotencyKey: z.uuid(),
}).refine((value) => value.method !== "CHECK" || value.checkNumber.length > 0, {
  path: ["checkNumber"],
  message: "Enter the check number.",
});

export const stationSquareNoteSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
  amountCents: z.number().int().positive().max(10_000_000),
  receiptNumber: z.string().trim().max(60).default(""),
});

export const stationSquareUnmatchedSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
});

export const stationSquareMatchSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
  providerPaymentId: z.string().trim().min(1).max(100),
});

/** One of today's unmatched Square payments that Square itself ties to this registration. Nothing else is sent. */
export type StationSquareCandidate = {
  providerPaymentId: string;
  amountCents: number;
  /** Time of day in the event's zone, zone named; empty when Square gave none. */
  whenLabel: string;
  /** More than the balance due, usually the card fee the payer was charged on top. */
  overBalance: boolean;
};

/** One line of the registration's money history on the station. No staff names, no card or Square details. */
export type StationPaymentHistoryEntry = {
  id: string;
  kind: "PAYMENT" | "CARD_NOTE" | "BALANCE_REASON";
  at: string;
  /** Date and time in the event's time zone, ready to show. */
  whenLabel: string;
  /** Plain-words line, for example "Check #1042 - $25.00 (refunded $5.00)". */
  text: string;
  /** The station the entry was made at, when it was made at one. */
  stationLabel: string | null;
};

export const STATION_HISTORY_LIMIT = 10;

/** "CASH" to "Cash", a check with its number, a card reference to "Card". */
export function stationPaymentMethodLabel(method: string, reference: string | null) {
  switch (method) {
    case "CASH": return "Cash";
    case "CHECK": return reference?.trim() ? `Check #${reference.trim()}` : "Check";
    case "CARD_REFERENCE": return "Card";
    default: return "Recorded by staff";
  }
}

export type StationPaymentSummary =
  | { state: "BILLED_TO_GROUP" }
  | { state: "PAID" }
  | {
    state: "DUE";
    balanceCents: number;
    /** The latest "Paid by card in Square app" note, still waiting for finance to match it. */
    squareAppNote: { amountCents: number; notedAt: string } | null;
  };

/** Pure: Paid / Balance due / billed to the church or group for one registration (attendee-balance semantics). */
export function stationPaymentSummary(input: {
  balanceCents: number;
  isDeferredOrganizationBilling: boolean;
  squareAppNote: { amountCents: number; notedAt: string } | null;
}): StationPaymentSummary {
  if (input.isDeferredOrganizationBilling) return { state: "BILLED_TO_GROUP" };
  if (input.balanceCents <= 0) return { state: "PAID" };
  return { state: "DUE", balanceCents: input.balanceCents, squareAppNote: input.squareAppNote };
}

export type StationFamilyMember = {
  id: string;
  firstName: string;
  lastName: string;
  attendeeType: string;
  checkedIn: boolean;
  /** A screening gate holds this person; the station never says why and offers no override. */
  needsDeskReview: boolean;
};

export type StationFamily = {
  registrationId: string;
  confirmationCode: string;
  attendees: StationFamilyMember[];
  payment: StationPaymentSummary;
  paymentHistory: StationPaymentHistoryEntry[];
};

export type StationCheckInResultStatus =
  | "CHECKED_IN"
  | "ALREADY_CHECKED_IN"
  | "NEEDS_DESK_REVIEW"
  | "SEND_TO_DESK"
  | "FAILED";

export type StationCheckInResult = { attendeeId: string; status: StationCheckInResultStatus };

/** "12", "12.5", "$12.50" to cents; null for anything else (no negatives, no letters, at most two decimals). */
export function parseDollarsToCents(text: string): number | null {
  const match = /^\$?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0 ? cents : null;
}

/** The plain wording for one person's result after Confirm check-in. */
export function stationResultLabel(status: StationCheckInResultStatus) {
  switch (status) {
    case "CHECKED_IN": return "Checked in";
    case "ALREADY_CHECKED_IN": return "Already checked in";
    case "NEEDS_DESK_REVIEW": return "Needs desk review - send to the check-in desk";
    case "SEND_TO_DESK": return "Send to the check-in desk";
    default: return "Not checked in - try again";
  }
}

/** "ADULT" to "Adult"; whatever the attendee-type value is, it is shown as plain words. */
export function stationAttendeeTypeLabel(type: string) {
  return type.toLowerCase().replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** "(check-in station "Front desk tablet")", or just "(check-in station)" without a label. */
export function stationSummarySuffix(label: string) {
  const clean = label.trim().slice(0, STATION_LABEL_MAX_LENGTH);
  return clean ? ` (check-in station "${clean}")` : " (check-in station)";
}

// ---------------------------------------------------------------------------------------------------------------
// Gate mode (#1684): an optional per-event view of the station for the person at the gate. It answers one question,
// "is this person registered for this event?", and shows the least that answers it.
// ---------------------------------------------------------------------------------------------------------------

export const GATE_MODE_OFF_MESSAGE =
  "Gate mode is off for this event. Ask a staff member to turn it on from Check-in.";

export const GATE_NAME_OR_PASS_MESSAGE = "The gate looks people up by name or by pass, not by confirmation code. Type the person's name or scan their pass.";

export const GATE_NAME_MIN_LENGTH = 2;
export const GATE_NAME_MAX_LENGTH = 80;
export const GATE_NAME_MESSAGE = `Type at least ${GATE_NAME_MIN_LENGTH} letters of the name.`;
export const GATE_RESULT_LIMIT = 10;

/** Staff turn gate mode on or off for one event. */
export const gateModeToggleSchema = z.strictObject({ enabled: z.boolean() });

export const gateLookupSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pass"), value: z.string().trim().min(1).max(768) }),
  z.strictObject({
    kind: z.literal("name"),
    value: z.string().trim().min(GATE_NAME_MIN_LENGTH, GATE_NAME_MESSAGE).max(GATE_NAME_MAX_LENGTH, GATE_NAME_MESSAGE),
  }),
]);

export const gateArrivalSchema = z.strictObject({
  attendeeId: z.string().trim().min(1).max(100),
  /** One per tap of "Log arrival at gate"; kept across retries of that tap. */
  idempotencyKey: z.uuid(),
});

/** Green, yellow or red. A person with no registration is the red state and never appears in a result list. */
export type GateState = "REGISTERED" | "STERLING_NOT_CURRENT" | "NOT_REGISTERED";

/** Pure: `sterlingCurrent` is null unless the person is an adult at an event that checks backgrounds. */
export function gateStateFor(sterlingCurrent: boolean | null): Exclude<GateState, "NOT_REGISTERED"> {
  return sterlingCurrent === false ? "STERLING_NOT_CURRENT" : "REGISTERED";
}

export function gateStateLabel(state: GateState) {
  switch (state) {
    case "REGISTERED": return "Registered";
    case "STERLING_NOT_CURRENT": return "Registered: Sterling not current";
    default: return "Not registered";
  }
}

export function gateStateReminder(state: GateState) {
  switch (state) {
    case "REGISTERED": return "Let them in.";
    case "STERLING_NOT_CURRENT": return "Call the event lead before letting them in.";
    default: return "Send them to registration or call the event lead.";
  }
}

/** The only fields a gate lookup returns about a person. No dates of birth, ages, health, payment or contact details. */
export type GateResult = {
  attendeeId: string;
  displayName: string;
  clubName: string | null;
  /** True or false only for an adult at an event that checks backgrounds; null says nothing about Sterling. */
  sterlingCurrent: boolean | null;
  state: Exclude<GateState, "NOT_REGISTERED">;
  /** When "Arrived at gate" was last logged, in the event's time zone ("3:42 PM CDT"), or null. */
  arrivedAtLabel: string | null;
};

export type GateLookupResponse = {
  /** MATCHES has at least one result; SEARCH_BY_NAME means a club pass named no one person; NAME_OR_PASS_ONLY means a confirmation code was typed. */
  outcome: "MATCHES" | "NOT_REGISTERED" | "SEARCH_BY_NAME" | "NAME_OR_PASS_ONLY";
  results: GateResult[];
  /** More people matched than are listed; the volunteer should type more of the name. */
  moreAvailable: boolean;
  message: string | null;
};

export type GateArrivalResponse = { attendeeId: string; arrivedAtLabel: string };

/** Pure: a pass-looking entry (a long dotted token with no spaces) is a pass, anything else is a name. */
export function classifyGateEntry(raw: string): z.infer<typeof gateLookupSchema> | null {
  const value = raw.trim();
  if (!value) return null;
  const looksLikePass = value.length >= 20 && value.includes(".") && !/\s/.test(value);
  return { kind: looksLikePass ? "pass" : "name", value };
}
