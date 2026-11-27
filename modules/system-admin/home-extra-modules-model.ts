/**
 * The numbers shown by three more staff Home modules (#1893): Club applications, Money this season and Live check-in.
 * Pure, no database access and no authorization: the caller reads only what the person may see
 * (`home-extra-modules-repository.ts`) and passes it in. Every number reuses a rule the app already keeps, and a read
 * that failed is `null`, shown as "Unavailable", never as 0.
 */
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { registrationBalance } from "@/modules/system-admin/dashboard";
import { formatCents } from "@/modules/payments/format-cents";
import { APPLICATIONS_PATH, applicationHref } from "@/modules/club-applications/queue-model";
import { newClubTypeLabels } from "@/modules/club-applications/domain";

const DAY_MS = 86_400_000;

// --- Club applications ---------------------------------------------------

export const CLUB_APPLICATIONS_MAX = 5;

/** Only what the card shows: no director, church contact or attachment. */
export type WaitingApplicationSource = { id: string; clubName: string; clubType: string; submittedAt: Date };

export type ClubApplicationsView = {
  /** Every application waiting for a decision (the queue's Waiting count). */
  waitingCount: number;
  /** The oldest waiting ones first, at most `CLUB_APPLICATIONS_MAX`. */
  rows: Array<{ id: string; clubName: string; clubTypeLabel: string; waitedText: string; href: string }>;
  href: string;
};

/** "Waiting 3 days", from whole days since it was submitted; under a day reads "Waiting since today". */
export function waitedText(submittedAt: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / DAY_MS));
  if (days === 0) return "Waiting since today";
  return days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
}

/** `oldest` must be the waiting applications, oldest first (the queue's order). */
export function buildClubApplications(waitingCount: number, oldest: readonly WaitingApplicationSource[], now: Date): ClubApplicationsView {
  return {
    waitingCount,
    rows: oldest.slice(0, CLUB_APPLICATIONS_MAX).map((row) => ({
      id: row.id,
      clubName: row.clubName,
      clubTypeLabel: newClubTypeLabels[row.clubType as keyof typeof newClubTypeLabels] ?? "Club",
      waitedText: waitedText(row.submittedAt, now),
      href: applicationHref(row.id),
    })),
    href: APPLICATIONS_PATH,
  };
}

// --- Money this season ---------------------------------------------------

export const MONEY_EVENTS_MAX = 6;

/** One event the person can open Payments for, with its money records. Amounts are whole cents. */
export type MoneyEventSource = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  /** Billed to churches after the event (`DEFERRED_ORGANIZATION_INVOICE`): no attendee balances. */
  churchBilled: boolean;
  /** Every SUCCEEDED payment of the event, with its SUCCEEDED refunds. */
  payments: Array<{ amountCents: number; refundedCents: number }>;
  /** Active (SUBMITTED or CONFIRMED) registrations, with SUCCEEDED payments and refunds: the dashboards' balance input. */
  activeRegistrations: Array<{ totalAmountCents: number; payments: Array<{ amountCents: number; refunds: Array<{ amountCents: number }> }> }>;
  /** Cancellation requests still waiting for a decision (the attention rule: REQUESTED) that ask for a refund. */
  requestedRefunds: { count: number; cents: number };
  /** Refunds sent to the processor and not yet answered (PENDING). */
  pendingRefunds: { count: number; cents: number };
};

export type MoneyFigures = {
  collectedCents: number;
  /** Null for an event billed to churches, which never has attendee balances. */
  owedCents: number | null;
  refundsWaiting: { count: number; cents: number };
};

export type MoneyEventRow = MoneyFigures & {
  id: string;
  name: string;
  href: string;
  collectedText: string;
  owedText: string;
  refundsText: string;
};

export type MoneyThisSeasonView = {
  clubYear: string;
  /** Every event the person can open Payments for this season, added up. */
  totals: { collectedText: string; owedText: string; refundsText: string; eventCount: number };
  rows: MoneyEventRow[];
  /** Events beyond `MONEY_EVENTS_MAX`, counted in the totals but not listed. */
  moreCount: number;
  footerLink: { href: string; label: string };
};

/**
 * One event's figures, by the rules the app already keeps:
 * - Collected: successful payments less their successful refunds (the money report's paid total net of refunds).
 * - Still owed: `registrationBalance` summed over active registrations, the balance rule behind the dashboards and the
 *   Events Administrator's open balances; an event billed to churches has none.
 * - Refunds waiting: cancellation requests waiting for a decision that ask for a refund, plus refunds still with the processor.
 */
export function moneyFigures(event: MoneyEventSource): MoneyFigures {
  const collectedCents = event.payments.reduce((total, payment) => total + payment.amountCents - payment.refundedCents, 0);
  const owedCents = event.churchBilled
    ? null
    : event.activeRegistrations.reduce((total, registration) => total + registrationBalance({ status: "CONFIRMED", ...registration }), 0);
  return {
    collectedCents,
    owedCents,
    refundsWaiting: {
      count: event.requestedRefunds.count + event.pendingRefunds.count,
      cents: event.requestedRefunds.cents + event.pendingRefunds.cents,
    },
  };
}

export function refundsWaitingText(refunds: { count: number; cents: number }): string {
  if (refunds.count === 0) return "None";
  return `${refunds.count} (${formatCents(refunds.cents)})`;
}

const owedText = (cents: number | null) => (cents === null ? "Billed to churches" : formatCents(cents));

/** The order the dashboards use: happening now, then upcoming (soonest first), then past (most recent first). */
function moneyOrder(now: Date) {
  const rank = (event: MoneyEventSource) => (event.endsAt < now ? 2 : event.startsAt > now ? 1 : 0);
  return (left: MoneyEventSource, right: MoneyEventSource) => rank(left) - rank(right)
    || (rank(left) === 2 ? right.startsAt.getTime() - left.startsAt.getTime() : left.startsAt.getTime() - right.startsAt.getTime())
    || left.name.localeCompare(right.name);
}

/** Payments for one event opens on that event; with no event chosen, the Payments page picks one. */
const paymentsHref = (eventId: string) => `/finance?event=${encodeURIComponent(eventId)}`;

export function buildMoneyThisSeason(clubYear: string, events: readonly MoneyEventSource[], now: Date): MoneyThisSeasonView {
  const sorted = [...events].sort(moneyOrder(now));
  const figures = sorted.map((event) => ({ event, figures: moneyFigures(event) }));
  const collected = figures.reduce((total, row) => total + row.figures.collectedCents, 0);
  const owed = figures.reduce((total, row) => total + (row.figures.owedCents ?? 0), 0);
  const refunds = figures.reduce((total, row) => ({ count: total.count + row.figures.refundsWaiting.count, cents: total.cents + row.figures.refundsWaiting.cents }), { count: 0, cents: 0 });
  const everyEventChurchBilled = figures.length > 0 && figures.every((row) => row.figures.owedCents === null);
  const rows = figures.slice(0, MONEY_EVENTS_MAX).map(({ event, figures: own }): MoneyEventRow => ({
    ...own,
    id: event.id,
    name: event.name,
    href: paymentsHref(event.id),
    collectedText: formatCents(own.collectedCents),
    owedText: owedText(own.owedCents),
    refundsText: refundsWaitingText(own.refundsWaiting),
  }));
  return {
    clubYear,
    totals: {
      collectedText: formatCents(collected),
      owedText: everyEventChurchBilled ? owedText(null) : formatCents(owed),
      refundsText: refundsWaitingText(refunds),
      eventCount: figures.length,
    },
    rows,
    moreCount: Math.max(0, figures.length - rows.length),
    footerLink: { href: "/finance", label: "Open Payments" },
  };
}

// --- Live check-in -------------------------------------------------------

/** The event dates the check-in window needs. */
export type CheckInWindowSource = { startsAt: Date; endsAt: Date; timezone: string; archivedAt: Date | null };

/**
 * Whether an event's check-in is open: from the start of its first calendar day through the end of its last, in the
 * event's own time zone (the days the app treats as the event's, `hasEventEnded`). An archived event is never open.
 */
export function isCheckInOpen(event: CheckInWindowSource, now: Date): boolean {
  if (event.archivedAt !== null) return false;
  const today = calendarDateInEventTimeZone(now, event.timezone);
  return today >= calendarDateInEventTimeZone(event.startsAt, event.timezone)
    && today <= calendarDateInEventTimeZone(event.endsAt, event.timezone);
}

export type LiveCheckInSource = CheckInWindowSource & {
  id: string;
  name: string;
  /** Attendees on active registrations, and those of them checked in (not undone): the dashboards' counts. */
  attendeeCount: number;
  checkedInCount: number;
  /** Active club registrations, and those with at least one person checked in. */
  clubCount: number;
  clubsCheckedInCount: number;
  /** The newest check-in that is not undone, on an active registration; null when nobody is checked in yet. */
  lastArrivalAt: Date | null;
};

export type LiveCheckInRow = {
  id: string;
  name: string;
  href: string;
  peopleText: string;
  /** Null when no club registered for the event. */
  clubsText: string | null;
  lastArrivalText: string;
  percentCheckedIn: number;
};

export type LiveCheckInView = { rows: LiveCheckInRow[] };

export function lastArrivalText(at: Date | null, timeZone: string): string {
  if (!at) return "No one checked in yet";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(at);
  return `Last arrival ${time}`;
}

/** Check-in for one event opens on that event's desk. */
const checkInHref = (eventId: string) => `/check-in?event=${encodeURIComponent(eventId)}`;

/** The events whose check-in is open now, soonest first; an empty list means the module stays off Home. */
export function buildLiveCheckIn(events: readonly LiveCheckInSource[], now: Date): LiveCheckInView {
  const rows = events
    .filter((event) => isCheckInOpen(event, now))
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.name.localeCompare(right.name))
    .map((event): LiveCheckInRow => ({
      id: event.id,
      name: event.name,
      href: checkInHref(event.id),
      peopleText: `${event.checkedInCount} of ${event.attendeeCount} ${event.attendeeCount === 1 ? "person" : "people"} checked in`,
      clubsText: event.clubCount > 0 ? `${event.clubsCheckedInCount} of ${event.clubCount} ${event.clubCount === 1 ? "club" : "clubs"} checked in` : null,
      lastArrivalText: lastArrivalText(event.lastArrivalAt, event.timezone),
      percentCheckedIn: event.attendeeCount > 0 ? Math.min(100, Math.round((event.checkedInCount / event.attendeeCount) * 100)) : 0,
    }));
  return { rows };
}
