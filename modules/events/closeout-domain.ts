/**
 * The event closeout checklist (#1515), pure rules, no database. `closeout-repository.ts` gathers the facts.
 *
 * Built on today's payment, refund, invoice, message and waitlist records and the Event money report (#1962), not the
 * ledger. Each check is ready, a warning or blocking:
 * - blocking checks stop the sign-off (and so the move to Closed): the money report's reconciliation, any pending
 *   payment or refund (money not settled), any failed refund, and, on a church-billed event, invoices still in draft;
 * - warnings must be acknowledged at sign-off: balances still owed, overpaid credit, failed payments, failed message
 *   deliveries, people still on the waitlist, and Square payments not matched to a registration;
 * - a value that could not be read is never ready: a blocking check that cannot be read stays blocking, a warning check
 *   that cannot be read stays a warning, and the sentence says it could not be checked.
 */
import type { MoneyReport } from "@/modules/payments/event-money-report-domain";
import type { UnmatchedSquareSummary } from "@/modules/payments/event-money-report-repository";

export type CloseoutState = "ready" | "warning" | "blocking";

export const closeoutCheckIds = [
  "money-reconciliation",
  "pending-payments",
  "pending-refunds",
  "failed-refunds",
  "draft-invoices",
  "outstanding-balances",
  "overpaid-credit",
  "failed-payments",
  "failed-messages",
  "waitlist",
  "unmatched-square",
] as const;
export type CloseoutCheckId = (typeof closeoutCheckIds)[number];

/** Who the link is for: the money report is open to report viewers; the other pages need finance access. */
export type CloseoutLinkAccess = "report" | "finance" | "event";

export type CloseoutCheck = {
  id: CloseoutCheckId;
  label: string;
  state: CloseoutState;
  /** How many items, or null when the check is not a count or could not be read. */
  count: number | null;
  /** Whole cents, or null when the check has no amount or could not be read. */
  cents: number | null;
  sentence: string;
  /** The page that lists the items, with the event in the query. */
  href: string;
  linkLabel: string;
  linkAccess: CloseoutLinkAccess;
};

export type CloseoutFacts = {
  eventId: string;
  /** The money report, or null when it could not be built. */
  report: Pick<MoneyReport, "check" | "uncountedPayments" | "uncountedRefunds" | "outstandingCents" | "overpaidCreditCents" | "owing"> | null;
  churchBilled: boolean;
  /** Invoices still in draft; null when unreadable. */
  draftInvoices: number | null;
  /** Failed message deliveries for this event that no later send has replaced; null when unreadable. */
  failedMessages: number | null;
  /** Registrations still WAITING on the waitlist; null when unreadable. */
  waitlistWaiting: number | null;
  square: UnmatchedSquareSummary;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const dollars = (cents: number) => `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const path = (route: string, eventId: string, query = "") => `${route}?event=${encodeURIComponent(eventId)}${query}`;

type Draft = Pick<CloseoutCheck, "id" | "label" | "linkLabel" | "linkAccess"> & { href: string };

function unreadable(draft: Draft, state: "warning" | "blocking", what: string): CloseoutCheck {
  return { ...draft, state, count: null, cents: null, sentence: `${what} could not be checked right now, so this is not counted as ready. Try again in a moment.` };
}

function countCheck(draft: Draft, input: {
  count: number | null;
  cents?: number | null;
  /** The state when there is something to look at. */
  whenOpen: "warning" | "blocking";
  what: string;
  open: (count: number) => string;
  clear: string;
}): CloseoutCheck {
  if (input.count === null) return unreadable(draft, input.whenOpen, input.what);
  if (input.count === 0) return { ...draft, state: "ready", count: 0, cents: input.cents ?? null, sentence: input.clear };
  return { ...draft, state: input.whenOpen, count: input.count, cents: input.cents ?? null, sentence: input.open(input.count) };
}

/** The whole checklist for one event, in the order it is shown: blocking checks first, then warnings. */
export function buildCloseoutChecklist(facts: CloseoutFacts): CloseoutCheck[] {
  const { eventId, report } = facts;
  const reportLink = { href: path("/finance/money-report", eventId), linkLabel: "Open the money report", linkAccess: "report" as const };
  const paymentsLink = { href: path("/finance", eventId, "&filter=ALL"), linkLabel: "Open payments", linkAccess: "finance" as const };

  const checks: CloseoutCheck[] = [];

  // Blocking.
  const moneyDraft: Draft = { id: "money-reconciliation", label: "Money report adds up", ...reportLink };
  checks.push(report === null
    ? unreadable(moneyDraft, "blocking", "The money report")
    : report.check.ok
      ? { ...moneyDraft, state: "ready", count: null, cents: null, sentence: "The money report adds up and matches each registration's balance." }
      : { ...moneyDraft, state: "blocking", count: null, cents: null, sentence: "The money report does not add up to the balances on the Payments page. Ask the finance office to look into it before closing." });

  checks.push(countCheck({ id: "pending-payments", label: "Pending payments", ...paymentsLink }, {
    count: report?.uncountedPayments.PENDING.count ?? null,
    cents: report?.uncountedPayments.PENDING.cents ?? null,
    whenOpen: "blocking",
    what: "Pending payments",
    open: (count) => `${plural(count, "payment is", "payments are")} still pending (${dollars(report!.uncountedPayments.PENDING.cents)}). Money that has not settled yet must be settled or voided first.`,
    clear: "No payments are pending.",
  }));
  checks.push(countCheck({ id: "pending-refunds", label: "Pending refunds", href: path("/finance/cancellation-requests", eventId), linkLabel: "Open refunds", linkAccess: "finance" }, {
    count: report?.uncountedRefunds.PENDING.count ?? null,
    cents: report?.uncountedRefunds.PENDING.cents ?? null,
    whenOpen: "blocking",
    what: "Pending refunds",
    open: (count) => `${plural(count, "refund is", "refunds are")} still pending (${dollars(report!.uncountedRefunds.PENDING.cents)}). Wait for each to settle first.`,
    clear: "No refunds are pending.",
  }));
  checks.push(countCheck({ id: "failed-refunds", label: "Failed refunds", href: path("/finance/cancellation-requests", eventId), linkLabel: "Open refunds", linkAccess: "finance" }, {
    count: report?.uncountedRefunds.FAILED.count ?? null,
    cents: report?.uncountedRefunds.FAILED.cents ?? null,
    whenOpen: "blocking",
    what: "Failed refunds",
    open: (count) => `${plural(count, "refund", "refunds")} failed (${dollars(report!.uncountedRefunds.FAILED.cents)}), so someone is still owed money. Retry or resolve each one first.`,
    clear: "No refunds failed.",
  }));

  const draftInvoiceDraft: Draft = { id: "draft-invoices", label: "Church invoices in draft", href: path("/finance/invoices", eventId), linkLabel: "Open invoices", linkAccess: "finance" };
  checks.push(!facts.churchBilled
    ? { ...draftInvoiceDraft, state: "ready", count: 0, cents: null, sentence: "This event is not billed to churches, so it has no church invoices to finalize." }
    : countCheck(draftInvoiceDraft, {
      count: facts.draftInvoices,
      whenOpen: "blocking",
      what: "Church invoices",
      open: (count) => `${plural(count, "church invoice is", "church invoices are")} still in draft. Finalize or discard each one first.`,
      clear: "Every church invoice is finalized.",
    }));

  // Warnings.
  const owingCount = report?.owing.length ?? null;
  checks.push(countCheck({ id: "outstanding-balances", label: "Balances still owed", href: path("/finance", eventId, "&filter=BALANCE"), linkLabel: "Open balances due", linkAccess: "finance" }, {
    count: owingCount,
    cents: report?.outstandingCents ?? null,
    whenOpen: "warning",
    what: "Balances",
    open: (count) => `${plural(count, "registration still owes", "registrations still owe")} ${dollars(report!.outstandingCents)} in total. Closing leaves that money uncollected.`,
    clear: "No attendee balances are owed.",
  }));
  const overpaid = report?.overpaidCreditCents ?? null;
  checks.push(overpaid === null
    ? unreadable({ id: "overpaid-credit", label: "Overpaid credit", ...reportLink }, "warning", "Overpaid credit")
    : overpaid === 0
      ? { id: "overpaid-credit", label: "Overpaid credit", ...reportLink, state: "ready", count: null, cents: 0, sentence: "Nobody has paid more than they owe." }
      : { id: "overpaid-credit", label: "Overpaid credit", ...reportLink, state: "warning", count: null, cents: overpaid, sentence: `Registrations have paid ${dollars(overpaid)} more than they owe. That credit is owed back or needs to be applied.` });
  checks.push(countCheck({ id: "failed-payments", label: "Failed payments", ...paymentsLink }, {
    count: report?.uncountedPayments.FAILED.count ?? null,
    cents: report?.uncountedPayments.FAILED.cents ?? null,
    whenOpen: "warning",
    what: "Failed payments",
    open: (count) => `${plural(count, "payment", "payments")} failed (${dollars(report!.uncountedPayments.FAILED.cents)}). They are not counted as paid; make sure each person was followed up with.`,
    clear: "No payments failed.",
  }));
  checks.push(countCheck({ id: "failed-messages", label: "Failed message deliveries", href: path("/communications", eventId), linkLabel: "Open emails", linkAccess: "event" }, {
    count: facts.failedMessages,
    whenOpen: "warning",
    what: "Message deliveries",
    open: (count) => `${plural(count, "email", "emails")} for this event could not be delivered and ${count === 1 ? "has" : "have"} not been resent. Some people may have missed a message.`,
    clear: "No message deliveries are waiting on a retry.",
  }));
  checks.push(countCheck({ id: "waitlist", label: "Waitlist", href: path("/finance", eventId, "&filter=WAITLISTED"), linkLabel: "Open the waitlisted registrations", linkAccess: "finance" }, {
    count: facts.waitlistWaiting,
    whenOpen: "warning",
    what: "The waitlist",
    open: (count) => `${plural(count, "registration is", "registrations are")} still waiting on the waitlist. They were never promoted or released.`,
    clear: "Nobody is waiting on the waitlist.",
  }));
  const squareDraft: Draft = { id: "unmatched-square", label: "Square payments not matched", href: path("/finance/square-payments", eventId), linkLabel: "Open the match tool", linkAccess: "finance" };
  const { square } = facts;
  checks.push(square.state === "ok"
    ? countCheck(squareDraft, {
      count: square.count,
      cents: square.cents,
      whenOpen: "warning",
      what: "Square payments",
      open: (count) => `${plural(count, "Square payment", "Square payments")} (${dollars(square.cents)}) ${count === 1 ? "is" : "are"} not matched to a registration of this event.`,
      clear: "Every Square payment for this event is matched.",
    })
    : square.state === "notConfigured"
      ? { ...squareDraft, state: "warning", count: null, cents: null, sentence: "Square is not set up on this site, so unmatched Square payments could not be checked. This is not counted as ready. Ask the system administrator to set it up." }
      : { ...squareDraft, state: "warning", count: null, cents: null, sentence: "Square could not be reached, so unmatched Square payments could not be checked. This is not counted as ready. Try again in a moment." });

  return checks;
}

export type CloseoutSummary = { blocking: number; warning: number; ready: number; canSignOff: boolean };

export function summarizeCloseout(checks: readonly CloseoutCheck[]): CloseoutSummary {
  const blocking = checks.filter((check) => check.state === "blocking").length;
  const warning = checks.filter((check) => check.state === "warning").length;
  return { blocking, warning, ready: checks.length - blocking - warning, canSignOff: blocking === 0 };
}

/** What a sign-off stores: ids, states, counts and cents only. No sentence, link, name or contact detail. */
export type CloseoutSnapshotCheck = { id: CloseoutCheckId; state: CloseoutState; count: number | null; cents: number | null };

export function closeoutSnapshot(checks: readonly CloseoutCheck[]): CloseoutSnapshotCheck[] {
  return checks.map(({ id, state, count, cents }) => ({ id, state, count, cents }));
}

/** What is stored on a sign-off: the checks as of `checkedAt` (an ISO time). */
export type StoredCloseoutSnapshot = { checkedAt: string; checks: CloseoutSnapshotCheck[] };

export function storedCloseoutSnapshot(checks: readonly CloseoutCheck[], checkedAt: Date): StoredCloseoutSnapshot {
  return { checkedAt: checkedAt.toISOString(), checks: closeoutSnapshot(checks) };
}

/**
 * The checks that are not ready, as sorted "id:state:count:cents" strings. The page sends the set it showed; the server
 * compares it with its own, so a warnings tick always belongs to the list (and the numbers) the signer saw.
 */
export function openChecksSignature(checks: readonly Pick<CloseoutCheck, "id" | "state" | "count" | "cents">[]): string[] {
  return checks
    .filter((check) => check.state !== "ready")
    .map((check) => `${check.id}:${check.state}:${check.count ?? "-"}:${check.cents ?? "-"}`)
    .sort();
}

export function sameOpenChecks(left: readonly string[], right: readonly string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export const CLOSEOUT_STALE_MESSAGE = "The checklist changed; review it again.";

/** The stored checked-at time, or null for a snapshot written without one. */
export function parseCloseoutCheckedAt(value: unknown): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const checkedAt = (value as Record<string, unknown>).checkedAt;
  return typeof checkedAt === "string" ? checkedAt : null;
}

/** Reads a stored snapshot back for display, dropping anything that is not a well-formed row. */
export function parseCloseoutSnapshot(value: unknown): CloseoutSnapshotCheck[] {
  if (value && !Array.isArray(value) && typeof value === "object") value = (value as Record<string, unknown>).checks;
  if (!Array.isArray(value)) return [];
  const states = new Set<string>(["ready", "warning", "blocking"]);
  const ids = new Set<string>(closeoutCheckIds);
  return value.flatMap((row): CloseoutSnapshotCheck[] => {
    if (!row || typeof row !== "object") return [];
    const { id, state, count, cents } = row as Record<string, unknown>;
    if (typeof id !== "string" || !ids.has(id) || typeof state !== "string" || !states.has(state)) return [];
    return [{
      id: id as CloseoutCheckId,
      state: state as CloseoutState,
      count: typeof count === "number" ? count : null,
      cents: typeof cents === "number" ? cents : null,
    }];
  });
}

export const checkLabels: Record<CloseoutCheckId, string> = {
  "money-reconciliation": "Money report adds up",
  "pending-payments": "Pending payments",
  "pending-refunds": "Pending refunds",
  "failed-refunds": "Failed refunds",
  "draft-invoices": "Church invoices in draft",
  "outstanding-balances": "Balances still owed",
  "overpaid-credit": "Overpaid credit",
  "failed-payments": "Failed payments",
  "failed-messages": "Failed message deliveries",
  "waitlist": "Waitlist",
  "unmatched-square": "Square payments not matched",
};

export const CLOSEOUT_NOTE_MAX_LENGTH = 500;

export const closeoutStateWords: Record<CloseoutState, string> = {
  ready: "Ready",
  warning: "Warning",
  blocking: "Blocking",
};

/** Why a sign-off is refused, or null when it may go ahead. `acknowledged` is the signer's explicit tick. */
export function signoffRefusal(summary: CloseoutSummary, acknowledged: boolean): { code: "BLOCKING_CHECKS" | "WARNINGS_NOT_ACKNOWLEDGED"; message: string } | null {
  if (summary.blocking > 0) {
    return {
      code: "BLOCKING_CHECKS",
      message: `${plural(summary.blocking, "blocking check is", "blocking checks are")} still open. Settle ${summary.blocking === 1 ? "it" : "them"} before signing off.`,
    };
  }
  if (summary.warning > 0 && !acknowledged) {
    return {
      code: "WARNINGS_NOT_ACKNOWLEDGED",
      message: `${plural(summary.warning, "warning is", "warnings are")} open. Tick the box to say you have reviewed ${summary.warning === 1 ? "it" : "them"}, then sign off.`,
    };
  }
  return null;
}
