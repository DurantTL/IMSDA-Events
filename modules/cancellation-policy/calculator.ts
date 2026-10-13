import {
  describeTerms,
  formatCents,
  type CancellationRules,
  type CancellationScope,
  type CancellationTerms,
  type ChargeCategory,
} from "@/modules/cancellation-policy/rules";
import { windowClosesAt } from "@/modules/cancellation-policy/event-time";

/**
 * The deterministic cancellation calculator (#169). Pure: it takes a policy version and a snapshot of facts and returns
 * a proposed outcome. It never reads a clock, a database or a payment provider, and nothing it returns is applied: the
 * result says `sideEffects: NONE`. Cancelling, refunding and issuing credit belong to later slices (#170, #171) and to
 * humans.
 *
 * The money model, in one place:
 * - Every charge on the registration is an entry (a priced form line, the card processing fee, a staff adjustment,
 *   a merchandise order line). The entries in scope for the cancellation each split into an eligible part (refundable
 *   at the window's share) and a withheld part (nonrefundable, or the share the window does not return), with a
 *   reason. In scope entries plus the entries that stay (`keptChargesCents`) always add up to what was charged.
 * - Shared entries (the card fee, tax, registration-wide adjustments) follow the people or components that are
 *   cancelled by their share of the price, rounded half away from zero.
 * - Cash then follows a fixed order. Money already paid first covers the charges that stay; what is left pays, in this
 *   order, the withheld charges, the window's flat fee, and a forfeited deposit; the remainder is the refund. A
 *   withholding that paid money cannot cover is reported as `unpaidWithholdingCents` and is not charged to anyone.
 * - Amounts are integer cents; products are computed in BigInt so no amount can lose precision.
 */

export const CALCULATION_SCHEMA_VERSION = 1;

export type ChargeSource =
  | "PRICING_LINE"
  | "PRICING_FEE"
  | "APPLIED_SURCHARGE"
  | "ADJUSTMENT"
  | "MERCHANDISE_ORDER"
  | "UNRECONCILED"
  | "SYNTHETIC";

/** One original charge entry. Amounts are signed: a discount is negative. */
export type ChargeEntry = {
  id: string;
  source: ChargeSource;
  label: string;
  amountCents: number;
  /** What the entry is before any policy classification. */
  category: ChargeCategory;
  /** The form field a priced line came from, so a policy can classify or exclude it. */
  fieldKey: string | null;
  attendeeId: string | null;
  /** Paid at the time it was ordered, outside the registration's payments (a merchandise order). Counted as paid. */
  settledSeparately?: boolean;
  /** Which separately paid order this entry belongs to (so money is never mixed across orders); unset means the registration's payments. */
  moneySourceId?: string;
};

export type CalculationFacts = {
  evaluatedAt: string;
  /** SERVER for any calculation that could be recorded; the preview tool may evaluate "as of" another moment. */
  clock: "SERVER" | "STAFF_PREVIEW_OVERRIDE";
  eventTimezone: string;
  /** Null for a synthetic input, which has no registration behind it. */
  registration: { id: string; confirmationCode: string; status: string } | null;
  attendees: Array<{ id: string; position: number }>;
  charges: ChargeEntry[];
  /** Succeeded payments less succeeded refunds on the registration. */
  registrationPaidCents: number;
  /** The forfeitable reservation deposit (#415): the deposit amount held, net of refunds, never including the card fee charged on a card deposit. 0 when none. */
  depositCents: number;
  depositSource: "RECORDED_DEPOSIT" | "PAID_AT_LEAST_DEPOSIT" | "NONE";
  /** Staff-recorded fact: the registrant did not arrive for the first night. */
  noShowFirstNight: boolean;
};

export type CancellationSelection = {
  scope: CancellationScope;
  /** Registration attendee ids, for the ATTENDEE scope. */
  attendeeIds?: readonly string[];
  /** Charge entry ids, for the COMPONENT scope. */
  chargeIds?: readonly string[];
};

export type PolicyVersionRecord = {
  id: string;
  version: number;
  effectiveFrom: Date;
  rules: CancellationRules;
};

export type CalculationStatus =
  | "CALCULATED"
  | "NO_POLICY"
  | "NOT_CANCELLABLE"
  | "SCOPE_NOT_ALLOWED"
  | "INVALID_SELECTION"
  | "COMPONENT_NOT_SUPPORTED";

export type ResultLine = {
  chargeId: string;
  label: string;
  category: ChargeCategory;
  source: ChargeSource;
  attendeeId: string | null;
  /** The original charge. */
  amountCents: number;
  /** The part of it this cancellation covers; the card fee and other shared entries are a share. */
  inScopeCents: number;
  treatment: "REFUNDABLE" | "NONREFUNDABLE" | "KEPT";
  eligibleCents: number;
  withheldCents: number;
  reason: string;
};

export type CancellationResult = {
  schemaVersion: typeof CALCULATION_SCHEMA_VERSION;
  status: CalculationStatus;
  message: string | null;
  /** Nothing this result describes has been done. */
  sideEffects: { cancelled: false; refunded: false; creditCreated: false; ledgerWritten: false };
  evaluatedAt: string;
  clock: CalculationFacts["clock"];
  eventTimezone: string;
  policy: { versionId: string; version: number; effectiveFrom: string; rules: CancellationRules } | null;
  scope: { requested: CancellationScope; effective: CancellationScope; attendeeIds: string[]; chargeIds: string[] } | null;
  timing: {
    kind: "WINDOW" | "AFTER_WINDOWS" | "NO_SHOW";
    windowId: string | null;
    label: string;
    endsOn: string | null;
    /** The first instant after the window; the cancellation is inside it when evaluated before this. */
    closesAt: string | null;
    terms: CancellationTerms;
    termsText: string;
  } | null;
  lines: ResultLine[];
  flatFee: { label: string; cents: number } | null;
  totals: {
    chargedCents: number;
    inScopeCents: number;
    keptChargesCents: number;
    eligibleCents: number;
    withheldCents: number;
  };
  money: {
    paidCents: number;
    refundCents: number;
    retainedCents: number;
    unpaidWithholdingCents: number;
    /** The same money split by where it was paid, so each source can be refunded on its own (#171). */
    bySource: Array<{ sourceId: string; label: string; paidCents: number; refundCents: number; retainedCents: number }>;
  };
  deposit: {
    heldCents: number;
    source: CalculationFacts["depositSource"];
    outcome: "NO_DEPOSIT" | "STAYS_WITH_REGISTRATION" | "REFUNDED" | "FORFEITED";
    forfeitedCents: number;
  };
  feeTreatment: { cardFeeCents: number; treatment: "REFUNDABLE" | "NONREFUNDABLE"; flatFeeCents: number };
  capacity: { registrationCancelled: boolean; attendeesReleased: string[]; componentsReleased: string[]; waitlistPlaceReleased: boolean };
  creditOption: { available: boolean; maximumCents: number; note: string };
  explanation: string[];
  facts: CalculationFacts;
};

/**
 * The version in effect at `at`: the highest-numbered version whose effective date has arrived. A higher version
 * always supersedes every lower one, so a later correction replaces an earlier (even future-dated) mistake for good.
 */
export function selectPolicyVersion<T extends { version: number; effectiveFrom: Date }>(versions: readonly T[], at: Date): T | null {
  let best: T | null = null;
  for (const candidate of versions) {
    if (candidate.effectiveFrom.getTime() > at.getTime()) continue;
    if (!best || candidate.version > best.version) best = candidate;
  }
  return best;
}

/** a * b / c rounded half away from zero, exact for any safe-integer inputs. */
export function mulDivRound(a: number, b: number, c: number) {
  if (c === 0 || a === 0 || b === 0) return 0;
  const negative = (a < 0) !== (b < 0);
  const numerator = BigInt(Math.abs(a)) * BigInt(Math.abs(b));
  const denominator = BigInt(Math.abs(c));
  const rounded = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  const value = Number(rounded);
  return negative ? -value : value;
}

const SHARED_CATEGORIES: ReadonlySet<ChargeCategory> = new Set<ChargeCategory>(["FEE", "TAX", "ADJUSTMENT"]);

function isShared(entry: ChargeEntry, category: ChargeCategory) {
  return entry.attendeeId === null && SHARED_CATEGORIES.has(category);
}

function effectiveCategory(entry: ChargeEntry, rules: CancellationRules): ChargeCategory {
  if (entry.source !== "PRICING_LINE" && entry.source !== "SYNTHETIC") return entry.category;
  if (!entry.fieldKey) return entry.category;
  const match = rules.classifications.find((classification) => classification.fieldKeys.includes(entry.fieldKey as string));
  return match ? match.category : entry.category;
}

function isNonrefundable(entry: ChargeEntry, category: ChargeCategory, rules: CancellationRules) {
  if (entry.amountCents <= 0) return false;
  if (category === "FEE" && rules.cardFeeTreatment === "NONREFUNDABLE") return true;
  if (rules.nonrefundable.categories.includes(category)) return true;
  return entry.fieldKey !== null && rules.nonrefundable.fieldKeys.includes(entry.fieldKey);
}

function isSupportedComponent(entry: ChargeEntry, category: ChargeCategory, rules: CancellationRules) {
  const supported = rules.supportedComponents;
  return (supported.categories as readonly ChargeCategory[]).includes(category) || (entry.fieldKey !== null && supported.fieldKeys.includes(entry.fieldKey));
}

function refundPercent(terms: CancellationTerms) {
  if (terms.refund.kind === "FULL") return 100;
  if (terms.refund.kind === "NONE") return 0;
  return terms.refund.percent;
}

function emptyResult(facts: CalculationFacts, status: CalculationStatus, message: string): CancellationResult {
  return {
    schemaVersion: CALCULATION_SCHEMA_VERSION,
    status,
    message,
    sideEffects: { cancelled: false, refunded: false, creditCreated: false, ledgerWritten: false },
    evaluatedAt: facts.evaluatedAt,
    clock: facts.clock,
    eventTimezone: facts.eventTimezone,
    policy: null,
    scope: null,
    timing: null,
    lines: [],
    flatFee: null,
    totals: { chargedCents: facts.charges.reduce((total, entry) => total + entry.amountCents, 0), inScopeCents: 0, keptChargesCents: 0, eligibleCents: 0, withheldCents: 0 },
    money: { paidCents: 0, refundCents: 0, retainedCents: 0, unpaidWithholdingCents: 0, bySource: [] },
    deposit: { heldCents: facts.depositCents, source: facts.depositSource, outcome: facts.depositCents > 0 ? "STAYS_WITH_REGISTRATION" : "NO_DEPOSIT", forfeitedCents: 0 },
    feeTreatment: { cardFeeCents: 0, treatment: "REFUNDABLE", flatFeeCents: 0 },
    capacity: { registrationCancelled: false, attendeesReleased: [], componentsReleased: [], waitlistPlaceReleased: false },
    creditOption: { available: false, maximumCents: 0, note: "No outcome was calculated." },
    explanation: [message],
    facts,
  };
}

function policySummary(policy: PolicyVersionRecord) {
  return { versionId: policy.id, version: policy.version, effectiveFrom: policy.effectiveFrom.toISOString(), rules: policy.rules };
}

export function calculateCancellation(input: {
  facts: CalculationFacts;
  selection: CancellationSelection;
  policyVersions: readonly PolicyVersionRecord[];
}): CancellationResult {
  const { facts, selection } = input;
  const at = new Date(facts.evaluatedAt);
  if (Number.isNaN(at.getTime())) throw new Error("evaluatedAt must be an ISO timestamp.");

  const policy = selectPolicyVersion(input.policyVersions, at);
  if (!policy) {
    return emptyResult(facts, "NO_POLICY", "This event has no cancellation policy version in effect at that time, so no outcome is proposed.");
  }
  const rules = policy.rules;
  const withPolicy = (result: CancellationResult): CancellationResult => ({ ...result, policy: policySummary(policy) });

  if (facts.registration && (facts.registration.status === "CANCELLED" || facts.registration.status === "DRAFT")) {
    return withPolicy(emptyResult(facts, "NOT_CANCELLABLE", `A ${facts.registration.status.toLowerCase()} registration cannot be cancelled.`));
  }
  if (!rules.allowedScopes.includes(selection.scope)) {
    return withPolicy(emptyResult(facts, "SCOPE_NOT_ALLOWED", `This policy does not allow cancelling by ${scopeWords(selection.scope)}.`));
  }

  // ---- Scope and selection ----
  const allAttendeeIds = facts.attendees.map((attendee) => attendee.id);
  const categories = new Map(facts.charges.map((entry) => [entry.id, effectiveCategory(entry, rules)]));
  let effectiveScope: CancellationScope = selection.scope;
  const attendeeIds = [...new Set(selection.attendeeIds ?? [])].sort();
  const chargeIds = [...new Set(selection.chargeIds ?? [])].sort();
  const notes: string[] = [];

  if (selection.scope === "ATTENDEE") {
    if (attendeeIds.length === 0) return withPolicy(emptyResult(facts, "INVALID_SELECTION", "Choose at least one attendee."));
    const unknown = attendeeIds.filter((id) => !allAttendeeIds.includes(id));
    if (unknown.length > 0) return withPolicy(emptyResult(facts, "INVALID_SELECTION", "One of the chosen attendees is not on this registration."));
    if (allAttendeeIds.length > 0 && allAttendeeIds.every((id) => attendeeIds.includes(id))) {
      if (!rules.allowedScopes.includes("FULL_REGISTRATION")) {
        return withPolicy(emptyResult(facts, "SCOPE_NOT_ALLOWED", "Removing every attendee cancels the whole registration, and this policy does not allow that."));
      }
      effectiveScope = "FULL_REGISTRATION";
      notes.push("Every attendee was chosen, so this is evaluated as cancelling the whole registration.");
    }
  }
  if (selection.scope === "COMPONENT") {
    if (chargeIds.length === 0) return withPolicy(emptyResult(facts, "INVALID_SELECTION", "Choose at least one charge."));
    const byId = new Map(facts.charges.map((entry) => [entry.id, entry]));
    if (chargeIds.some((id) => !byId.has(id))) return withPolicy(emptyResult(facts, "INVALID_SELECTION", "One of the chosen charges is not on this registration."));
    if (chargeIds.some((id) => (byId.get(id) as ChargeEntry).amountCents <= 0)) {
      return withPolicy(emptyResult(facts, "INVALID_SELECTION", "Only a charge with an amount above $0 can be cancelled on its own."));
    }
    const unsupported = chargeIds.filter((id) => !isSupportedComponent(byId.get(id) as ChargeEntry, categories.get(id) as ChargeCategory, rules));
    if (unsupported.length > 0) {
      const labels = unsupported.map((id) => (byId.get(id) as ChargeEntry).label).join(", ");
      return withPolicy(emptyResult(facts, "COMPONENT_NOT_SUPPORTED", `This policy does not allow cancelling these on their own: ${labels}.`));
    }
  }

  // ---- Timing: which terms apply ----
  let timing: NonNullable<CancellationResult["timing"]>;
  if (facts.noShowFirstNight && rules.noShow) {
    timing = { kind: "NO_SHOW", windowId: null, label: rules.noShow.label, endsOn: null, closesAt: null, terms: rules.noShow.terms, termsText: describeTerms(rules.noShow.terms) };
  } else {
    const window = rules.windows.find((candidate) => at.getTime() < windowClosesAt(candidate.endsOn, facts.eventTimezone).getTime());
    if (window) {
      timing = {
        kind: "WINDOW", windowId: window.id, label: window.label, endsOn: window.endsOn,
        closesAt: windowClosesAt(window.endsOn, facts.eventTimezone).toISOString(), terms: window.terms, termsText: describeTerms(window.terms),
      };
    } else {
      const last = rules.windows[rules.windows.length - 1];
      timing = {
        kind: "AFTER_WINDOWS", windowId: null, label: rules.afterWindows.label, endsOn: last?.endsOn ?? null,
        closesAt: last ? windowClosesAt(last.endsOn, facts.eventTimezone).toISOString() : null,
        terms: rules.afterWindows.terms, termsText: describeTerms(rules.afterWindows.terms),
      };
    }
  }
  const terms = timing.terms;
  const percent = refundPercent(terms);

  // ---- What is in scope ----
  // Shared charges (the registration's card fee, tax, adjustments) follow the registration's own price lines only;
  // merchandise orders are separate purchases and never part of the base.
  const isRegistrationSource = (entry: ChargeEntry) => !entry.moneySourceId && !entry.settledSeparately;
  const direct = facts.charges.filter((entry) => isRegistrationSource(entry) && !isShared(entry, categories.get(entry.id) as ChargeCategory));
  const directBase = direct.reduce((total, entry) => total + Math.max(entry.amountCents, 0), 0);
  const directInScope = (entry: ChargeEntry) => {
    if (effectiveScope === "FULL_REGISTRATION") return true;
    if (effectiveScope === "ATTENDEE") return entry.attendeeId !== null && attendeeIds.includes(entry.attendeeId);
    return chargeIds.includes(entry.id);
  };
  const directInScopeBase = direct.filter(directInScope).reduce((total, entry) => total + Math.max(entry.amountCents, 0), 0);

  const lines: ResultLine[] = facts.charges.map((entry) => {
    const category = categories.get(entry.id) as ChargeCategory;
    const shared = isShared(entry, category);
    let inScopeCents: number;
    let scopeNote: string;
    if (effectiveScope === "FULL_REGISTRATION") {
      inScopeCents = entry.amountCents;
      scopeNote = "";
    } else if (shared && !(effectiveScope === "COMPONENT" && chargeIds.includes(entry.id))) {
      inScopeCents = mulDivRound(entry.amountCents, directInScopeBase, directBase);
      scopeNote = ` Only this cancellation's ${formatPercentShare(directInScopeBase, directBase)} share of this shared charge is included.`;
    } else if (directInScope(entry)) {
      inScopeCents = entry.amountCents;
      scopeNote = "";
    } else {
      inScopeCents = 0;
      scopeNote = "";
    }
    if (inScopeCents === 0 && entry.amountCents !== 0) {
      return {
        chargeId: entry.id, label: entry.label, category, source: entry.source, attendeeId: entry.attendeeId,
        amountCents: entry.amountCents, inScopeCents: 0, treatment: "KEPT", eligibleCents: 0, withheldCents: 0,
        reason: "Not part of this cancellation; it stays charged.",
      };
    }
    const nonrefundable = isNonrefundable(entry, category, rules);
    let eligibleCents: number;
    let reason: string;
    if (nonrefundable) {
      eligibleCents = 0;
      reason = category === "FEE" ? "Card processing fees are nonrefundable under this policy." : `Nonrefundable under this policy (${categoryWords(category)}).`;
    } else {
      eligibleCents = mulDivRound(inScopeCents, percent, 100);
      reason = percent === 100
        ? `${timing.label}: refundable in full.`
        : percent === 0
          ? `${timing.label}: no refund.`
          : `${timing.label}: ${percent}% refundable.`;
    }
    return {
      chargeId: entry.id, label: entry.label, category, source: entry.source, attendeeId: entry.attendeeId,
      amountCents: entry.amountCents, inScopeCents, treatment: nonrefundable ? "NONREFUNDABLE" : "REFUNDABLE",
      eligibleCents, withheldCents: inScopeCents - eligibleCents, reason: reason + scopeNote,
    };
  });

  const chargedCents = facts.charges.reduce((total, entry) => total + entry.amountCents, 0);
  const inScopeCents = lines.reduce((total, line) => total + line.inScopeCents, 0);
  const keptChargesCents = chargedCents - inScopeCents;
  const linesEligible = lines.reduce((total, line) => total + line.eligibleCents, 0);
  const linesWithheld = lines.reduce((total, line) => total + line.withheldCents, 0);
  // The flat fee comes out of registration money only, so it is capped at what registration charges leave eligible.
  const registrationEligible = lines.reduce((total, line) => total + (isRegistrationSource(facts.charges.find((entry) => entry.id === line.chargeId) as ChargeEntry) ? line.eligibleCents : 0), 0);
  const flatApplied = Math.min(terms.flatWithholdCents, Math.max(registrationEligible, 0));
  const cardFeeCents = lines.filter((line) => line.category === "FEE").reduce((total, line) => total + line.inScopeCents, 0);

  // ---- Cash, in a fixed order, separately for each place the money was paid ----
  // The registration's payments and each merchandise order are separate sources, so a registration fee is never taken
  // out of merchandise money. The flat fee and the deposit belong to the registration, so only its payments cover them.
  const wholeRegistration = effectiveScope === "FULL_REGISTRATION";
  const sourceOf = (entry: ChargeEntry) => entry.moneySourceId ?? (entry.settledSeparately ? "separate" : "registration");
  const sourceIds = ["registration", ...new Set(facts.charges.map(sourceOf).filter((id) => id !== "registration"))];
  const lineById = new Map(lines.map((line) => [line.chargeId, line]));
  const forfeitRequested = wholeRegistration && terms.depositTreatment === "FORFEIT" && facts.depositCents > 0;
  let paidCents = 0;
  let refundCents = 0;
  let retainedCents = 0;
  let forfeitedCents = 0;
  let unpaidWithholdingCents = 0;
  const bySource: CancellationResult["money"]["bySource"] = [];
  let orderNumber = 0;
  for (const sourceId of sourceIds) {
    const entries = facts.charges.filter((entry) => sourceOf(entry) === sourceId);
    const isRegistration = sourceId === "registration";
    const sourcePaid = isRegistration ? facts.registrationPaidCents : entries.reduce((total, entry) => total + entry.amountCents, 0);
    const sourceKept = entries.reduce((total, entry) => total + entry.amountCents - (lineById.get(entry.id)?.inScopeCents ?? 0), 0);
    const sourceWithheld = entries.reduce((total, entry) => total + (lineById.get(entry.id)?.withheldCents ?? 0), 0);
    let remaining = Math.max(sourcePaid - sourceKept, 0);
    const retainedForLines = Math.min(Math.max(sourceWithheld, 0), remaining);
    remaining -= retainedForLines;
    const retainedForFlat = isRegistration ? Math.min(flatApplied, remaining) : 0;
    remaining -= retainedForFlat;
    const forfeited = isRegistration && forfeitRequested ? Math.min(facts.depositCents, remaining) : 0;
    remaining -= forfeited;
    paidCents += sourcePaid;
    refundCents += remaining;
    retainedCents += retainedForLines + retainedForFlat + forfeited;
    forfeitedCents += forfeited;
    unpaidWithholdingCents += (Math.max(sourceWithheld, 0) - retainedForLines) + (isRegistration ? flatApplied - retainedForFlat : 0);
    if (!isRegistration) orderNumber += 1;
    bySource.push({
      sourceId,
      label: isRegistration ? "Registration payments" : `Merchandise order ${orderNumber}`,
      paidCents: sourcePaid,
      refundCents: remaining,
      retainedCents: retainedForLines + retainedForFlat + forfeited,
    });
  }

  const depositOutcome: CancellationResult["deposit"]["outcome"] = facts.depositCents <= 0
    ? "NO_DEPOSIT"
    : !wholeRegistration
      ? "STAYS_WITH_REGISTRATION"
      : terms.depositTreatment === "FORFEIT" ? "FORFEITED" : "REFUNDED";

  // ---- Credit, capacity, explanation ----
  const creditAvailable = terms.creditAllowed && refundCents > 0;
  // A waitlisted registration holds no seat (SUBMITTED and CONFIRMED both do), so cancelling it releases a waitlist
  // place, not capacity.
  const waitlisted = facts.registration?.status === "WAITLISTED";
  const releasedAttendees = waitlisted ? [] : wholeRegistration ? [...allAttendeeIds].sort() : effectiveScope === "ATTENDEE" ? attendeeIds : [];
  const releasedComponents = !waitlisted && effectiveScope === "COMPONENT" ? chargeIds : [];

  const explanation: string[] = [
    `Policy version ${policy.version} (effective ${policy.effectiveFrom.toISOString()}) applies at ${facts.evaluatedAt}${facts.clock === "STAFF_PREVIEW_OVERRIDE" ? " (a staff-chosen preview time, not the server clock)" : " (server time)"}.`,
    timing.kind === "WINDOW"
      ? `That is before the end of ${timing.endsOn} in ${facts.eventTimezone} (${timing.closesAt}): ${timing.label}, ${timing.termsText}.`
      : timing.kind === "NO_SHOW"
        ? `A first-night no-show was recorded: ${timing.label}, ${timing.termsText}.`
        : `Every window has closed: ${timing.label}, ${timing.termsText}.`,
    ...notes,
    `Charged ${formatCents(chargedCents)}; ${formatCents(inScopeCents)} is part of this cancellation and ${formatCents(keptChargesCents)} stays charged.`,
    `Of the cancelled charges, ${formatCents(Math.max(linesEligible - flatApplied, 0))} is eligible and ${formatCents(linesWithheld + flatApplied)} is withheld${flatApplied > 0 ? `, including the ${formatCents(flatApplied)} ${terms.flatWithholdLabel.toLowerCase()}` : ""}.`,
    `${formatCents(paidCents)} has been paid. After the charges that stay, ${formatCents(retainedCents)} would be kept and ${formatCents(refundCents)} would be refundable.`,
  ];
  if (depositOutcome === "FORFEITED") explanation.push(`The ${formatCents(facts.depositCents)} reservation deposit is forfeited: ${formatCents(forfeitedCents)} of paid money is kept and the reservation is cancelled.`);
  if (depositOutcome === "REFUNDED") explanation.push(`The ${formatCents(facts.depositCents)} reservation deposit is refunded with the other paid money.`);
  if (waitlisted) explanation.push(wholeRegistration ? "This registration is on the waitlist: its waitlist place would be released; no seat or capacity is freed." : "This registration is on the waitlist, so no seat or capacity is freed.");
  if (depositOutcome === "FORFEITED") explanation.push("Any card fee charged on the deposit is not part of the deposit; it follows the card fee rule.");
  if (depositOutcome === "STAYS_WITH_REGISTRATION") explanation.push("The reservation deposit belongs to the registration, so it stays with it when only part of it is cancelled.");
  if (unpaidWithholdingCents > 0) explanation.push(`${formatCents(unpaidWithholdingCents)} of the withheld amount was never paid, so there is nothing to keep; this calculation does not charge it.`);
  explanation.push("Nothing has been cancelled, refunded or credited. This is a proposed outcome only.");

  return {
    schemaVersion: CALCULATION_SCHEMA_VERSION,
    status: "CALCULATED",
    message: null,
    sideEffects: { cancelled: false, refunded: false, creditCreated: false, ledgerWritten: false },
    evaluatedAt: facts.evaluatedAt,
    clock: facts.clock,
    eventTimezone: facts.eventTimezone,
    policy: policySummary(policy),
    scope: { requested: selection.scope, effective: effectiveScope, attendeeIds, chargeIds },
    timing,
    lines,
    flatFee: terms.flatWithholdCents > 0 ? { label: terms.flatWithholdLabel, cents: flatApplied } : null,
    totals: {
      chargedCents,
      inScopeCents,
      keptChargesCents,
      eligibleCents: Math.max(linesEligible - flatApplied, 0),
      withheldCents: linesWithheld + flatApplied,
    },
    money: { paidCents, refundCents, retainedCents, unpaidWithholdingCents, bySource },
    deposit: { heldCents: facts.depositCents, source: facts.depositSource, outcome: depositOutcome, forfeitedCents },
    feeTreatment: { cardFeeCents, treatment: rules.cardFeeTreatment, flatFeeCents: flatApplied },
    capacity: { registrationCancelled: wholeRegistration, attendeesReleased: releasedAttendees, componentsReleased: releasedComponents, waitlistPlaceReleased: waitlisted && wholeRegistration },
    creditOption: creditAvailable
      ? { available: true, maximumCents: refundCents, note: "Future-event credit up to the refundable amount may be offered instead of a refund. Nothing has been issued." }
      : { available: false, maximumCents: 0, note: terms.creditAllowed ? "There is no refundable amount to turn into credit." : "This policy does not offer future-event credit for this cancellation." },
    explanation,
    facts,
  };
}

function scopeWords(scope: CancellationScope) {
  return scope === "FULL_REGISTRATION" ? "the whole registration" : scope === "ATTENDEE" ? "one attendee" : "individual components";
}

function categoryWords(category: ChargeCategory) {
  return category.toLowerCase();
}

function formatPercentShare(part: number, whole: number) {
  return whole === 0 ? "0%" : `${((part / whole) * 100).toFixed(1)}%`;
}
