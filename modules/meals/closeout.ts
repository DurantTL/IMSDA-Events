import { z } from "zod";
import type { MealPayerValue, MealTypeValue } from "@/modules/meals/domain";
import { sha256Hex } from "@/modules/meals/scanner-import";
import type { KitchenCountsReport } from "@/modules/meals/kitchen-counts";
import { serviceKey, serviceLabel } from "@/modules/meals/served-report";
import { toCsv } from "@/modules/reporting/csv";

/**
 * Meal money closeout (#212): a reviewable projection that lines up what the meal ledger charged and credited, what the
 * conference is owed for the meals it paid for, the counter (walk-up) orders, and the meals the café scanner served, per
 * meal service, and lists every difference as a named exception. Pure rules, no database.
 *
 * Nothing here writes. The projection reads the meal ledger, the registration's MEAL adjustment lines, the selections,
 * the redemption events and the kitchen's counts as they are, and never rewrites, nets out or "fixes" any of them. A
 * source that is missing is an exception, never a zero. Kitchen counts (prepared, wasted, donated, transferred) are shown
 * beside the money for reading only: they are not financial entries and are never proof of revenue. The closeout review
 * issues no refund and changes no price; staff acknowledge an exception, which records who and when and nothing else.
 */

export type CloseoutSelection = {
  id: string;
  mealType: MealTypeValue;
  /** Empty for a ticket good on any day (the same convention as the served report). */
  serviceDate: string;
  source: "REGISTRATION_FORM" | "STAFF" | "WALK_UP" | "PLAN_ASSIGNMENT";
  payer: MealPayerValue;
  status: "ACTIVE" | "CANCELLED";
  quantity: number;
  unitPriceCents: number;
  /** What the conference is billed per meal used, for a conference-paid selection; zero when no rate was on file. */
  conferenceRateCents: number;
};
export type CloseoutLedgerEntry = {
  id: string;
  selectionId: string;
  mealType: MealTypeValue;
  serviceDate: string;
  kind: "CHARGE" | "CREDIT";
  /** Signed as stored: a credit is negative. */
  amountCents: number;
  payer: MealPayerValue;
  settlement: "IN_REGISTRATION_PRICING" | "REGISTRATION_ADJUSTMENT" | "AT_COUNTER" | "REGISTRATION_NOT_LIVE";
  registrationAdjustmentId: string | null;
};
/** A MEAL adjustment line on a registration, as the registration's total holds it. */
export type CloseoutAdjustment = { id: string; amountCents: number };
export type CloseoutTicket = { id: string; number: number; selectionId: string; cancelled: boolean };

export type CloseoutInput = {
  selections: readonly CloseoutSelection[];
  ledger: readonly CloseoutLedgerEntry[];
  adjustments: readonly CloseoutAdjustment[];
  tickets: readonly CloseoutTicket[];
  /** Ticket ids whose current state is served (the latest redemption event is REDEEMED). */
  served: ReadonlySet<string>;
  /** Ticket ids with an accepted un-redeem correction at any time. */
  unredeemed: ReadonlySet<string>;
  /** Whether any scanner results were imported for the event. */
  anyImport: boolean;
  kitchen: Pick<KitchenCountsReport, "rows">;
};

export type ExceptionCategory = "COUNT" | "FINANCIAL" | "CREDENTIAL" | "PROTECTED_ACTION";
export const exceptionCategoryLabels: Record<ExceptionCategory, string> = {
  COUNT: "Counts", FINANCIAL: "Money", CREDENTIAL: "Tickets and scanning", PROTECTED_ACTION: "Finance-only actions",
};

export type MealCases = { paid: number; complimentary: number; conference: number; walkUp: number };
export type CloseoutRow = {
  key: string;
  label: string;
  serviceDate: string;
  mealType: MealTypeValue;
  /** Attendee-payer ledger: charges, credits (negative) and their net. Conference-payer entries carry no amount. */
  charges: number;
  credits: number;
  net: number;
  /** The net split by where the ledger says the money went. */
  settlement: { inRegistration: number; registrationAdjustment: number; counter: number; registrationNotLive: number };
  /** Active tickets by case. A walk-up is its own case whether or not it was priced. */
  ordered: MealCases;
  /** Of those, the ones the scanner currently shows as served. */
  served: MealCases;
  /** Meals served on a ticket cancelled afterwards: never in `ordered`, never in the cases above. */
  servedOnCancelled: number;
  /** Conference-paid meals served (active or cancelled afterwards) and what the conference is billed for them at the rates on file. */
  conferenceServed: number;
  conferenceBilled: number;
  /** Served conference meals whose selection has no rate on file. */
  conferenceRateMissing: number;
  /** The kitchen's current counts, shown for reading. Null until entered (not the same as zero). */
  kitchen: { prepared: number | null; wasted: number | null; donated: number | null; transferred: number | null };
};
export type CloseoutTotals = Omit<CloseoutRow, "key" | "serviceDate" | "mealType" | "label">;

export type CloseoutException = {
  /** `CODE:scope`, stable across loads: the address a review is recorded against. */
  key: string;
  code: string;
  category: ExceptionCategory;
  /** The service label, or "Whole event" / a source id's kind. */
  scope: string;
  message: string;
  /** The figures behind it; a change to any of them makes an earlier review read as out of date. */
  detail: Record<string, number | string>;
  detailDigest: string;
  /** Source record ids (ledger entries, selections, adjustments, tickets) for the drilldown. Ids only, no names. */
  sourceIds: string[];
};
export type CloseoutProjection = {
  rows: CloseoutRow[];
  totals: CloseoutTotals;
  exceptions: CloseoutException[];
  /** Counts of the source records read, and a digest of them: unchanged source data gives the same digest and totals. */
  sources: { selections: number; ledgerEntries: number; adjustments: number; tickets: number; served: number; kitchenEntries: number; digest: string };
};

const SOURCE_IDS_SHOWN = 25;
const zeroCases = (): MealCases => ({ paid: 0, complimentary: 0, conference: 0, walkUp: 0 });
const sumCases = (cases: MealCases) => cases.paid + cases.complimentary + cases.conference + cases.walkUp;
export const totalMeals = sumCases;

function caseOf(selection: CloseoutSelection): keyof MealCases {
  if (selection.payer === "CONFERENCE") return "conference";
  if (selection.source === "WALK_UP") return "walkUp";
  return selection.unitPriceCents > 0 ? "paid" : "complimentary";
}

const emptyRow = (serviceDate: string, mealType: MealTypeValue): CloseoutRow => ({
  key: serviceKey(serviceDate, mealType), label: serviceLabel(serviceDate, mealType), serviceDate, mealType,
  charges: 0, credits: 0, net: 0,
  settlement: { inRegistration: 0, registrationAdjustment: 0, counter: 0, registrationNotLive: 0 },
  ordered: zeroCases(), served: zeroCases(), servedOnCancelled: 0, conferenceServed: 0, conferenceBilled: 0, conferenceRateMissing: 0,
  kitchen: { prepared: null, wasted: null, donated: null, transferred: null },
});

const settlementField = {
  IN_REGISTRATION_PRICING: "inRegistration", REGISTRATION_ADJUSTMENT: "registrationAdjustment", AT_COUNTER: "counter", REGISTRATION_NOT_LIVE: "registrationNotLive",
} as const;

function makeException(
  code: string, category: ExceptionCategory, scopeKey: string, scope: string, message: string,
  detail: Record<string, number | string>, sourceIds: readonly string[] = [],
): CloseoutException {
  const ids = [...sourceIds].sort();
  return {
    key: `${code}:${scopeKey}`, code, category, scope, message, detail,
    detailDigest: sha256Hex(JSON.stringify(Object.entries(detail).sort(([a], [b]) => a.localeCompare(b)))).slice(0, 32),
    sourceIds: ids.slice(0, SOURCE_IDS_SHOWN),
  };
}

const dollars = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
export const formatCents = dollars;

export function buildCloseout(input: CloseoutInput): CloseoutProjection {
  const rows = new Map<string, CloseoutRow>();
  const ensure = (serviceDate: string, mealType: MealTypeValue) => {
    const key = serviceKey(serviceDate, mealType);
    let row = rows.get(key);
    if (!row) { row = emptyRow(serviceDate, mealType); rows.set(key, row); }
    return row;
  };
  const exceptions: CloseoutException[] = [];
  const selections = new Map(input.selections.map((selection) => [selection.id, selection]));
  const label = (serviceDate: string, mealType: MealTypeValue) => serviceLabel(serviceDate, mealType);

  // Ledger: attendee-payer entries make the money columns; each selection's own net is checked against what it should be.
  const ledgerBySelection = new Map<string, CloseoutLedgerEntry[]>();
  for (const entry of input.ledger) {
    const row = ensure(entry.serviceDate, entry.mealType);
    if (entry.payer === "ATTENDEE") {
      if (entry.kind === "CHARGE") row.charges += entry.amountCents; else row.credits += entry.amountCents;
      row.net += entry.amountCents;
      row.settlement[settlementField[entry.settlement]] += entry.amountCents;
    }
    ledgerBySelection.set(entry.selectionId, [...(ledgerBySelection.get(entry.selectionId) ?? []), entry]);
  }
  for (const selection of input.selections) {
    const row = ensure(selection.serviceDate, selection.mealType);
    const entries = ledgerBySelection.get(selection.id) ?? [];
    const expected = selection.status === "ACTIVE" ? selection.quantity * selection.unitPriceCents : 0;
    const actual = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
    if (entries.length === 0 && expected !== 0) {
      exceptions.push(makeException(
        "LEDGER_MISSING", "FINANCIAL", selection.id, label(row.serviceDate, row.mealType),
        "A meal order has no ledger entries, so its charge cannot be traced.", { expectedCents: expected, ledgerCents: 0 }, [selection.id],
      ));
    } else if (entries.length > 0 && actual !== expected) {
      exceptions.push(makeException(
        "LEDGER_MISMATCH", "FINANCIAL", selection.id, label(row.serviceDate, row.mealType),
        "The ledger's net for a meal order differs from the order's quantity times its price.",
        { expectedCents: expected, ledgerCents: actual, differenceCents: actual - expected }, [selection.id, ...entries.map((entry) => entry.id)],
      ));
    }
  }

  // Registration adjustments: every ledger line posted to a registration traces to one MEAL adjustment of the same amount,
  // and every MEAL adjustment traces back to a ledger line.
  const adjustments = new Map(input.adjustments.map((adjustment) => [adjustment.id, adjustment]));
  const referenced = new Set<string>();
  for (const entry of input.ledger) {
    if (entry.settlement !== "REGISTRATION_ADJUSTMENT" || entry.payer !== "ATTENDEE") continue;
    const scope = label(entry.serviceDate, entry.mealType);
    const adjustment = entry.registrationAdjustmentId ? adjustments.get(entry.registrationAdjustmentId) : undefined;
    if (entry.registrationAdjustmentId) referenced.add(entry.registrationAdjustmentId);
    if (!adjustment) {
      if (entry.amountCents !== 0) {
        exceptions.push(makeException(
          "ADJUSTMENT_MISSING", "FINANCIAL", entry.id, scope,
          "A ledger line says it was posted to a registration, but no matching meal adjustment line exists.",
          { ledgerCents: entry.amountCents, adjustmentCents: "none" }, [entry.id, ...(entry.registrationAdjustmentId ? [entry.registrationAdjustmentId] : [])],
        ));
      }
    } else if (adjustment.amountCents !== entry.amountCents) {
      exceptions.push(makeException(
        "ADJUSTMENT_MISMATCH", "FINANCIAL", entry.id, scope,
        "A ledger line and the meal adjustment line it was posted as have different amounts.",
        { ledgerCents: entry.amountCents, adjustmentCents: adjustment.amountCents, differenceCents: adjustment.amountCents - entry.amountCents }, [entry.id, adjustment.id],
      ));
    }
  }
  for (const adjustment of input.adjustments) {
    if (referenced.has(adjustment.id)) continue;
    exceptions.push(makeException(
      "ADJUSTMENT_ORPHAN", "FINANCIAL", adjustment.id, "Whole event",
      "A meal adjustment line on a registration has no ledger line behind it.", { adjustmentCents: adjustment.amountCents }, [adjustment.id],
    ));
  }

  // Tickets and redemptions: cases, served, and conference billing. A meal served stays served after a later cancellation.
  const servedOnCancelledIds = new Map<string, string[]>();
  const rateMissingIds = new Map<string, string[]>();
  for (const ticket of input.tickets) {
    const selection = selections.get(ticket.selectionId);
    if (!selection) continue;
    const row = ensure(selection.serviceDate, selection.mealType);
    const isServed = input.served.has(ticket.id);
    const active = !ticket.cancelled && selection.status === "ACTIVE";
    if (active) {
      const field = caseOf(selection);
      row.ordered[field] += 1;
      if (isServed) row.served[field] += 1;
    } else if (isServed) {
      row.servedOnCancelled += 1;
      servedOnCancelledIds.set(row.key, [...(servedOnCancelledIds.get(row.key) ?? []), ticket.id]);
    }
    if (isServed && selection.payer === "CONFERENCE") {
      row.conferenceServed += 1;
      if (selection.conferenceRateCents > 0) row.conferenceBilled += selection.conferenceRateCents;
      else {
        row.conferenceRateMissing += 1;
        rateMissingIds.set(row.key, [...(rateMissingIds.get(row.key) ?? []), selection.id]);
      }
    }
  }

  // Kitchen counts, for reading beside the money.
  for (const kitchen of input.kitchen.rows) {
    const row = ensure(kitchen.serviceDate, kitchen.mealType);
    row.kitchen = {
      prepared: kitchen.counts.PREPARED?.quantity ?? null, wasted: kitchen.counts.WASTED?.quantity ?? null,
      donated: kitchen.counts.DONATED?.quantity ?? null, transferred: kitchen.counts.TRANSFERRED?.quantity ?? null,
    };
  }

  const sorted = [...rows.values()].sort((a, b) => (a.serviceDate || "9999-99-99").localeCompare(b.serviceDate || "9999-99-99") || a.mealType.localeCompare(b.mealType));
  for (const row of sorted) {
    const servedTotal = sumCases(row.served) + row.servedOnCancelled;
    if (row.conferenceRateMissing > 0) {
      exceptions.push(makeException(
        "CONFERENCE_RATE_MISSING", "FINANCIAL", row.key, row.label,
        "Conference-paid meals were served but no rate is on file for them, so what the conference owes is not known. It is not counted as zero.",
        { mealsWithoutRate: row.conferenceRateMissing }, rateMissingIds.get(row.key),
      ));
    }
    if (row.servedOnCancelled > 0) {
      exceptions.push(makeException(
        "SERVED_ON_CANCELLED", "CREDENTIAL", row.key, row.label,
        "Meals were served on tickets that were cancelled afterwards. They stay counted as served; any credit already given is not changed.",
        { meals: row.servedOnCancelled }, servedOnCancelledIds.get(row.key),
      ));
    }
    const { prepared, wasted, donated, transferred } = row.kitchen;
    if (servedTotal > 0 && prepared === null) {
      exceptions.push(makeException("PREPARED_MISSING", "COUNT", row.key, row.label, "Meals were served but the kitchen entered no prepared count.", { served: servedTotal }));
    }
    if (prepared !== null && servedTotal > prepared) {
      exceptions.push(makeException("SERVED_EXCEEDS_PREPARED", "COUNT", row.key, row.label, "More meals were served than the kitchen says it prepared.", { served: servedTotal, prepared }));
    }
    const out = (wasted ?? 0) + (donated ?? 0) + (transferred ?? 0);
    if (prepared !== null && out + servedTotal > prepared && servedTotal <= prepared) {
      exceptions.push(makeException(
        "DISPOSED_EXCEEDS_PREPARED", "COUNT", row.key, row.label,
        "Served plus wasted, donated and transferred is more than the kitchen says it prepared.",
        { served: servedTotal, wasted: wasted ?? 0, donated: donated ?? 0, transferred: transferred ?? 0, prepared },
      ));
    }
  }
  const orderedAll = sorted.reduce((sum, row) => sum + sumCases(row.ordered), 0);
  if (orderedAll > 0 && !input.anyImport) {
    exceptions.push(makeException("NO_SCANNER_IMPORT", "COUNT", "event", "Whole event", "Meal tickets were sold but no scanner results were imported, so nothing shows as served.", { ticketsSold: orderedAll }));
  }
  if (input.unredeemed.size > 0) {
    exceptions.push(makeException(
      "UNREDEEM_ACCEPTED", "PROTECTED_ACTION", "event", "Whole event",
      "Staff with finance access accepted corrections that took a meal back out of the served count. Review that each was right.",
      { tickets: input.unredeemed.size }, [...input.unredeemed],
    ));
  }
  const walkUpEntries = input.ledger.filter((entry) => entry.settlement === "AT_COUNTER");
  if (walkUpEntries.length > 0) {
    exceptions.push(makeException(
      "WALK_UP_RECEIPTS_NOT_RECORDED", "FINANCIAL", "event", "Whole event",
      "Walk-up orders are paid at the counter and no counter receipt is recorded here. Compare the walk-up net with the till.",
      { walkUpNetCents: walkUpEntries.reduce((sum, entry) => sum + entry.amountCents, 0), entries: walkUpEntries.length }, walkUpEntries.map((entry) => entry.id),
    ));
  }
  if (input.ledger.some((entry) => entry.amountCents !== 0 && entry.settlement !== "AT_COUNTER")) {
    exceptions.push(makeException(
      "RECEIPTS_NOT_ALLOCATED", "FINANCIAL", "event", "Whole event",
      "Registration payments and refunds are not split by meal, so what was actually received for meals is not shown. The meal charges above are what was billed, not what was paid.",
      { chargesBilledCents: input.ledger.filter((entry) => entry.payer === "ATTENDEE" && entry.settlement !== "AT_COUNTER").reduce((sum, entry) => sum + entry.amountCents, 0) },
    ));
  }
  exceptions.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));

  const totals: CloseoutTotals = {
    charges: 0, credits: 0, net: 0, settlement: { inRegistration: 0, registrationAdjustment: 0, counter: 0, registrationNotLive: 0 },
    ordered: zeroCases(), served: zeroCases(), servedOnCancelled: 0, conferenceServed: 0, conferenceBilled: 0, conferenceRateMissing: 0,
    kitchen: { prepared: null, wasted: null, donated: null, transferred: null },
  };
  for (const row of sorted) {
    totals.charges += row.charges; totals.credits += row.credits; totals.net += row.net;
    for (const field of Object.keys(totals.settlement) as Array<keyof CloseoutRow["settlement"]>) totals.settlement[field] += row.settlement[field];
    for (const field of Object.keys(totals.ordered) as Array<keyof MealCases>) { totals.ordered[field] += row.ordered[field]; totals.served[field] += row.served[field]; }
    totals.servedOnCancelled += row.servedOnCancelled; totals.conferenceServed += row.conferenceServed;
    totals.conferenceBilled += row.conferenceBilled; totals.conferenceRateMissing += row.conferenceRateMissing;
    for (const field of ["prepared", "wasted", "donated", "transferred"] as const) {
      if (row.kitchen[field] !== null) totals.kitchen[field] = (totals.kitchen[field] ?? 0) + (row.kitchen[field] ?? 0);
    }
  }
  return {
    rows: sorted, totals, exceptions,
    sources: {
      selections: input.selections.length, ledgerEntries: input.ledger.length, adjustments: input.adjustments.length, tickets: input.tickets.length,
      served: input.served.size, kitchenEntries: input.kitchen.rows.reduce((sum, row) => sum + row.history.length, 0),
      digest: closeoutSourceDigest(input),
    },
  };
}

/** A hash of the source records' ids and the fields the projection reads: the same source data always gives the same digest. */
export function closeoutSourceDigest(input: CloseoutInput): string {
  const lines = [
    ...input.selections.map((s) => `S|${s.id}|${s.status}|${s.quantity}|${s.unitPriceCents}|${s.conferenceRateCents}|${s.payer}|${s.source}`),
    ...input.ledger.map((l) => `L|${l.id}|${l.kind}|${l.amountCents}|${l.payer}|${l.settlement}|${l.registrationAdjustmentId ?? ""}`),
    ...input.adjustments.map((a) => `A|${a.id}|${a.amountCents}`),
    ...input.tickets.map((t) => `T|${t.id}|${t.cancelled ? 1 : 0}|${input.served.has(t.id) ? 1 : 0}`),
    ...input.kitchen.rows.map((r) => `K|${r.key}|${(["PREPARED", "WASTED", "DONATED", "TRANSFERRED"] as const).map((kind) => r.counts[kind]?.entryId ?? "").join(",")}`),
  ].sort();
  return sha256Hex(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Reviews: append-only decisions about exceptions.
// ---------------------------------------------------------------------------

export type CloseoutReview = {
  id: string;
  exceptionKey: string;
  status: "ACKNOWLEDGED" | "REOPENED";
  detailDigest: string;
  note: string;
  reviewedBy: string;
  reviewedAt: string;
};
export type ReviewedException = CloseoutException & {
  /** OPEN: never reviewed, reopened, or its figures changed since it was acknowledged. */
  state: "OPEN" | "ACKNOWLEDGED";
  /** True when it was acknowledged but its figures have changed since, so it is open again. */
  changedSinceReview: boolean;
  current: CloseoutReview | null;
  history: CloseoutReview[];
};

/** Attaches the review history. `reviews` are oldest first; the latest of a key is its current review. */
export function applyReviews(exceptions: readonly CloseoutException[], reviews: readonly CloseoutReview[]): ReviewedException[] {
  const byKey = new Map<string, CloseoutReview[]>();
  for (const review of reviews) byKey.set(review.exceptionKey, [...(byKey.get(review.exceptionKey) ?? []), review]);
  return exceptions.map((exception) => {
    const history = byKey.get(exception.key) ?? [];
    const current = history.at(-1) ?? null;
    const acknowledged = current?.status === "ACKNOWLEDGED";
    const matches = acknowledged && current.detailDigest === exception.detailDigest;
    return { ...exception, state: matches ? "ACKNOWLEDGED" : "OPEN", changedSinceReview: acknowledged && !matches, current, history };
  });
}

export const closeoutReviewInputSchema = z.object({
  exceptionKey: z.string().trim().min(1).max(200),
  status: z.enum(["ACKNOWLEDGED", "REOPENED"]),
  note: z.string().trim().min(1, "Add a note saying what you checked.").max(1000, "A note can be up to 1000 characters."),
  /** The figures digest the person saw; a review of an exception whose figures have since changed is refused. */
  detailDigest: z.string().min(1).max(128),
}).strict();
export type CloseoutReviewInput = z.infer<typeof closeoutReviewInputSchema>;

export function openExceptionCount(exceptions: readonly ReviewedException[]) {
  return exceptions.filter((exception) => exception.state === "OPEN").length;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const cell = (value: number | null) => (value === null ? "" : value);
/** Dollars as a number, not text, so a negative credit stays a number and is not formula-escaped. */
const centsCell = (cents: number) => Math.round(cents) / 100;

/** The money table as CSV, in dollars, one row per service and a total that is the sum of the rows shown. Cells are formula-escaped by `toCsv`. */
export function closeoutCsv(projection: CloseoutProjection): string {
  const line = (name: string, row: CloseoutTotals) => [
    name, centsCell(row.charges), centsCell(row.credits), centsCell(row.net),
    centsCell(row.settlement.inRegistration), centsCell(row.settlement.registrationAdjustment), centsCell(row.settlement.counter), centsCell(row.settlement.registrationNotLive),
    row.ordered.paid, row.ordered.complimentary, row.ordered.conference, row.ordered.walkUp,
    row.served.paid, row.served.complimentary, row.served.conference, row.served.walkUp, row.servedOnCancelled,
    row.conferenceServed, centsCell(row.conferenceBilled), row.conferenceRateMissing,
    cell(row.kitchen.prepared), cell(row.kitchen.wasted), cell(row.kitchen.donated), cell(row.kitchen.transferred),
  ];
  return "﻿" + toCsv([
    [
      "Service", "Meal charges", "Meal credits", "Net meal charges",
      "Net: in registration price", "Net: posted to registration", "Net: walk-up at counter", "Net: registration not live",
      "Ordered: paid", "Ordered: complimentary", "Ordered: conference-paid", "Ordered: walk-up",
      "Served: paid", "Served: complimentary", "Served: conference-paid", "Served: walk-up", "Served on cancelled tickets",
      "Conference-paid meals served", "Billed to conference at rates on file", "Served conference meals with no rate",
      "Kitchen prepared", "Kitchen wasted", "Kitchen donated", "Kitchen transferred",
    ],
    ...projection.rows.map((row) => line(row.label, row)),
    line("All services", projection.totals),
  ]);
}

export function closeoutExceptionsCsv(exceptions: readonly ReviewedException[]): string {
  return "﻿" + toCsv([
    ["Category", "Exception", "Service", "What it means", "Figures", "Status", "Reviewed by", "Reviewed at", "Note", "Source ids"],
    ...exceptions.map((exception) => [
      exceptionCategoryLabels[exception.category], exception.code, exception.scope, exception.message,
      Object.entries(exception.detail).map(([name, value]) => `${name}=${value}`).join("; "),
      exception.state === "ACKNOWLEDGED" ? "Acknowledged" : exception.changedSinceReview ? "Open (changed since reviewed)" : "Open",
      exception.current?.reviewedBy ?? "", exception.current?.reviewedAt ?? "", exception.current?.note ?? "", exception.sourceIds.join(" "),
    ]),
  ]);
}
