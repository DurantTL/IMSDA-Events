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
  | "PERMISSION_LOST";

export type StationRecordState = {
  expiresAt: Date;
  revokedAt: Date | null;
  stoppedAt: Date | null;
  /** True once the event's current dates say it is over (dates edited after the station started move this). */
  eventEnded?: boolean;
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

export const stationCheckInSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
  items: z.array(z.strictObject({
    attendeeId: z.string().trim().min(1).max(100),
    idempotencyKey: z.uuid(),
  })).min(1).max(100),
});

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
