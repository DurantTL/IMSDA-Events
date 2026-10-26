/**
 * The Events Administrator dashboard (#1227): pure model, no database access and no authorization.
 *
 * Scope is decided before this runs: the caller passes only events the signed-in person is an active EVENT_ADMIN of
 * (read on the server from their memberships, never from the query string). This file then drops anything archived or
 * ended, so the cards and every count are for assigned, upcoming events only.
 *
 * Every number says what one unit is:
 * - Active registrations: registrations with status SUBMITTED or CONFIRMED (the System home's rule).
 * - Registered (per event, and "expected attendees"): attendees on those registrations. Capacity is counted in the same
 *   unit, so "Registered X of <capacity>" compares like with like.
 * - Open balances: active registrations that still owe money (`registrationBalance` > 0), the rule the event overview's
 *   "balances to review" uses. An event billed to churches after the event never has attendee balances, so it counts 0.
 * - Incomplete forms: registrations still in DRAFT.
 * - Failed messages (last 7 days): the System attention rule, per event: failed, bounced or spam-marked in the last 7 days
 *   and not later resent. It goes down once a resend succeeds and after 7 days.
 * - Need attention: open balances plus incomplete forms. A registration is active or draft, never both, so nobody is
 *   counted twice. The three work rows are NOT added together (messages are not registrations).
 */
import { registrationStatusLabel } from "@/modules/events/public-registration-status";
import {
  buildSystemAdminDashboard,
  registrationBalance,
  type SystemAdminEventSource,
} from "@/modules/system-admin/dashboard";

export type EventsAdminEventSource = SystemAdminEventSource & {
  /** `EventBillingMode`; DEFERRED_ORGANIZATION_INVOICE means churches are billed after the event. */
  billingMode: string;
  /** Registrations in DRAFT. */
  draftRegistrationCount: number;
  /** Emails that failed, bounced or were marked spam in the last 7 days and were not later resent (the System attention rule). */
  failedEmailCount: number;
};

export type EventsAdminEventCard = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  timing: "UPCOMING" | "IN_PROGRESS";
  daysUntilStart: number | null;
  /** The #1201 status label: Registration open, Opens soon, Draft or Registration closed. */
  statusLabel: string;
  activeRegistrationCount: number;
  /** Attendees on active registrations. */
  registeredCount: number;
  capacity: number | null;
  /** "Registered 40 of 100", or "40 registered, no capacity set". */
  registeredText: string;
  openBalanceCount: number;
  billedToChurches: boolean;
  draftCount: number;
  messageCount: number;
  needAttentionCount: number;
  href: string;
  kitchenReportHref: string;
};

export type EventsAdminWorkKind = "open-balances" | "incomplete-forms" | "messages";

export type EventsAdminWorkItem = {
  eventId: string;
  eventName: string;
  count: number;
  href: string;
  /** Why a count is not what it looks like (a church-billed event), or null. */
  note: string | null;
};

export type EventsAdminWorkRow = {
  kind: EventsAdminWorkKind;
  label: string;
  /** What one unit is. */
  unit: string;
  /** This row's own total. Never added to another row's. */
  total: number;
  linkLabel: string;
  /** One item per assigned event: the link for each. */
  items: EventsAdminWorkItem[];
};

export const WORK_NOT_ADDED_NOTE = "These are not added together: one person can appear in more than one row.";

export type EventsAdminHome = {
  generatedAt: string;
  events: EventsAdminEventCard[];
  counts: {
    assignedEvents: number;
    activeRegistrations: number;
    needAttention: number;
    expectedAttendees: number;
  };
  /** The soonest assigned event that has not ended, or null. */
  next: { id: string; name: string; happeningNow: boolean; daysUntilStart: number | null; href: string } | null;
  workRows: EventsAdminWorkRow[];
};

export function eventHref(path: string, eventId: string, extra = "") {
  return `${path}?${extra ? `${extra}&` : ""}event=${encodeURIComponent(eventId)}`;
}

function registeredText(registered: number, capacity: number | null) {
  return capacity === null ? `${registered} registered, no capacity set` : `Registered ${registered} of ${capacity}`;
}

function eventWord(count: number) {
  return count === 1 ? "event" : "events";
}

/** "Across your 2 events": the real count, never "both". */
export function acrossYourEventsLabel(count: number) {
  return `Across your ${count} ${eventWord(count)}`;
}

export function buildEventsAdminHome(sources: readonly EventsAdminEventSource[], now: Date): EventsAdminHome {
  const extras = new Map(sources.map((source) => [source.id, source]));
  // Same per-event numbers, timing and sort as the System home. Platform-wide counts are not part of this read.
  const dashboard = buildSystemAdminDashboard({
    events: sources.filter((source) => source.archivedAt === null),
    activeUserCount: 0,
    pendingUserCount: 0,
    systemAdminCount: 0,
    unresolvedAlertCount: 0,
  }, now);

  const events: EventsAdminEventCard[] = [];
  for (const event of dashboard.events) {
    if (event.timing === "PAST") continue;
    const extra = extras.get(event.id)!;
    const billedToChurches = extra.billingMode === "DEFERRED_ORGANIZATION_INVOICE";
    const openBalanceCount = billedToChurches
      ? 0
      : event.registrations.filter((registration) => ["SUBMITTED", "CONFIRMED"].includes(registration.status) && registrationBalance(registration) > 0).length;
    const draftCount = extra.draftRegistrationCount;
    events.push({
      id: event.id,
      name: event.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      location: event.location,
      timing: event.timing,
      daysUntilStart: event.daysUntilStart,
      statusLabel: registrationStatusLabel(event.registrationPhase, event.publishedFormCount > 0),
      activeRegistrationCount: event.activeRegistrationCount,
      registeredCount: event.attendeeCount,
      capacity: event.capacity,
      registeredText: registeredText(event.attendeeCount, event.capacity),
      openBalanceCount,
      billedToChurches,
      draftCount,
      messageCount: extra.failedEmailCount,
      needAttentionCount: openBalanceCount + draftCount,
      href: eventHref("/overview", event.id),
      kitchenReportHref: eventHref("/more/kitchen-report", event.id),
    });
  }

  const first = events[0] ?? null;
  const row = (kind: EventsAdminWorkKind, label: string, unit: string, linkLabel: string, count: (event: EventsAdminEventCard) => number, href: (event: EventsAdminEventCard) => string, note?: (event: EventsAdminEventCard) => string | null): EventsAdminWorkRow => ({
    kind,
    label,
    unit,
    linkLabel,
    total: events.reduce((total, event) => total + count(event), 0),
    items: events.map((event) => ({ eventId: event.id, eventName: event.name, count: count(event), href: href(event), note: note?.(event) ?? null })),
  });

  return {
    generatedAt: now.toISOString(),
    events,
    counts: {
      assignedEvents: events.length,
      activeRegistrations: events.reduce((total, event) => total + event.activeRegistrationCount, 0),
      needAttention: events.reduce((total, event) => total + event.needAttentionCount, 0),
      expectedAttendees: events.reduce((total, event) => total + event.registeredCount, 0),
    },
    next: first
      ? { id: first.id, name: first.name, happeningNow: first.timing === "IN_PROGRESS", daysUntilStart: first.daysUntilStart, href: first.href }
      : null,
    workRows: [
      row("open-balances", "Open balances", "registrations that still owe money", "Open payments", (event) => event.openBalanceCount, (event) => eventHref("/finance", event.id, "filter=BALANCE"), (event) => (event.billedToChurches ? "Billed to churches after the event, so no attendee balances." : null)),
      row("incomplete-forms", "Incomplete forms", "draft registrations", "Open registrations", (event) => event.draftCount, (event) => eventHref("/people", event.id, "filter=DRAFT")),
      row("messages", "Failed messages (last 7 days)", "emails that failed, bounced or were marked spam and were not resent", "Open email deliveries", (event) => event.messageCount, (event) => eventHref("/communications", event.id, "view=deliveries")),
    ],
  };
}

export type EventsAdminTab = { key: string; label: string; href: string };

/**
 * The top tabs. Overview and My events always show; the rest open an event's page, so they show only when there is a
 * soonest event to open (`nextEventId`).
 */
export function eventsAdminTabs(nextEventId: string | null): EventsAdminTab[] {
  const tabs: EventsAdminTab[] = [
    { key: "overview", label: "Overview", href: "/events-admin" },
    { key: "my-events", label: "My events", href: "#your-events" },
  ];
  if (nextEventId) {
    tabs.push(
      { key: "registrations", label: "Registrations", href: eventHref("/people", nextEventId) },
      { key: "schedule", label: "Schedule", href: eventHref("/more/event-content", nextEventId) },
      { key: "kitchen", label: "Kitchen reports", href: eventHref("/more/kitchen-report", nextEventId) },
      { key: "messages", label: "Messages", href: eventHref("/communications", nextEventId) },
    );
  }
  return tabs;
}
