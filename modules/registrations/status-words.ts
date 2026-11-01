import type { RegistrationStatus } from "@prisma/client";

/**
 * The one set of status words (#1453, site rule B12). Display only: stored enum values, status logic and filter
 * query values never change. Client-safe: type-only Prisma imports, nothing server-only.
 *
 * A stored status that does not fit one of these words keeps its own wording (see the issue); do not add a word here.
 */
export const STATUS_WORDS = [
  "Draft",
  "Submitted",
  "Pending payment",
  "Pending approval",
  "Confirmed",
  "Waitlisted",
  "Cancelled",
  "Refunded",
] as const;

export type StatusWord = (typeof STATUS_WORDS)[number];

/** The plain word for each stored registration status, before any display context. */
export const registrationStatusWords = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  CANCELLED: "Cancelled",
} as const satisfies Record<RegistrationStatus, StatusWord>;

export type RegistrationStatusWordInput = {
  status: RegistrationStatus | `${RegistrationStatus}`;
  /** A personal-link registration the office has not approved yet (#804): shown as Pending approval. */
  awaitingApproval?: boolean;
  /** What the attendee could owe online. Above zero on a submitted registration reads Pending payment. */
  attendeeBalanceCents?: number;
  /** Church, organization or group billing: never an attendee balance, so never Pending payment. */
  deferredBilling?: boolean;
};

/** A registration made through a personal staff, pastor or volunteer link that the office has not approved yet (#804). */
export function registrationAwaitingApproval(record: { status: string; staffInvitation?: { approval: string | null } | null }) {
  return record.status === "DRAFT" && record.staffInvitation?.approval === "WAITING";
}

export function registrationStatusWord(input: RegistrationStatusWordInput): StatusWord {
  if (input.status === "CANCELLED" || input.status === "WAITLISTED") return registrationStatusWords[input.status];
  if (input.awaitingApproval) return "Pending approval";
  if (input.status === "SUBMITTED" && !input.deferredBilling && (input.attendeeBalanceCents ?? 0) > 0) return "Pending payment";
  return registrationStatusWords[input.status];
}

/** The word for a stored status string, or the raw text when it is not a registration status. */
export function registrationStatusWordOrRaw(status: string): string {
  return status in registrationStatusWords ? registrationStatusWords[status as RegistrationStatus] : status;
}

/** One waitlist format everywhere: "position 3", or "at Camp Heritage, position 3". */
export function waitlistPositionDetail(input: { position?: number | null; place?: string | null }): string | null {
  const position = input.position && input.position > 0 ? `position ${input.position}` : null;
  const place = input.place?.trim() ? `at ${input.place.trim()}` : null;
  const parts = [place, position].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** "Waitlisted · position 3" (or "Waitlisted · at <place>, position 3"); just "Waitlisted" with no detail. */
export function waitlistStatusText(input: { position?: number | null; place?: string | null }): string {
  const detail = waitlistPositionDetail(input);
  return detail ? `Waitlisted · ${detail}` : "Waitlisted";
}

export type MoneyStatusAudience = "staff" | "attendee";

export type MoneyStatusInput = {
  totalCents: number;
  balanceCents: number;
  /** Church, organization or group billing. */
  deferredBilling?: boolean;
  /** A "Group" registration is billed to its contact, not to a church. */
  isGroup?: boolean;
  audience?: MoneyStatusAudience;
  /** Format an amount for "$X due". Left out, the label is the plain "Balance due". */
  formatAmount?: (cents: number) => string;
};

/** The money state beside the status word: one wording, "Paid in full" never "Paid". */
export function registrationMoneyStatus(input: MoneyStatusInput): string {
  if (input.deferredBilling) {
    if (input.isGroup) return "Billed to group contact";
    return input.audience === "attendee" ? "Billed to your church" : "Billed to church";
  }
  if (input.balanceCents > 0) return input.formatAmount ? `${input.formatAmount(input.balanceCents)} due` : "Balance due";
  if (input.totalCents === 0) return "No charge";
  return "Paid in full";
}
