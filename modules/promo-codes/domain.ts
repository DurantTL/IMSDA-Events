import { formatCents } from "@/modules/payments/format-cents";
import type {
  FormCalculation,
  RegistrationFormDefinition,
  RegistrationFormField,
} from "@/modules/forms/definition";

export type PromoDiscountKind = "FIXED_CENTS" | "PERCENT_BPS";

export type PromoCodeRule = {
  id: string;
  code: string;
  normalizedCode: string;
  isActive: boolean;
  discountType: PromoDiscountKind;
  discountValue: number;
  startsOn: string | null;
  endsOn: string | null;
  minimumSubtotalCents: number | null;
  maximumUses: number | null;
  maximumDiscountCents: number | null;
  redeemedCount: number;
  /**
   * Attendee-type restriction (#102): `EventAttendeeType.code` values the code applies to. Absent or empty means every
   * attendee type (the code works exactly as it did before restrictions existed).
   */
  attendeeTypeCodes?: readonly string[];
};

/**
 * Whom a code is being tried for, so a restricted code can be judged. A per-person code (#397, a staff per-person
 * adjustment) is tried for one attendee; a registration-level code is tried against the whole calculation and the type
 * of each attendee on it (index-matched to the calculation's `attendeeIndex`). `null` is an attendee with no type.
 */
export type PromoAttendeeScope =
  | { kind: "ATTENDEE"; attendeeTypeCode: string | null }
  | { kind: "REGISTRATION"; calculation: FormCalculation; attendeeTypeCodes: ReadonlyArray<string | null> };

export type PromoCodeFailureReason =
  | "INVALID_FORMAT"
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "ENDED"
  | "MINIMUM_NOT_MET"
  | "USE_LIMIT_REACHED"
  | "ATTENDEE_TYPE_NOT_ELIGIBLE"
  | "NO_ELIGIBLE_SUBTOTAL";

export type PromoCodeEvaluation =
  | {
      valid: true;
      code: string;
      normalizedCode: string;
      eligibleSubtotalCents: number;
      discountAmountCents: number;
    }
  | {
      valid: false;
      reason: PromoCodeFailureReason;
      message: string;
    };

export type DiscountedFormCalculation = FormCalculation & {
  preDiscountSubtotalCents: number;
  discountAmountCents: number;
  promoCode: string;
};

const normalizedCodePattern = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizePromoCode(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}

export function isNormalizedPromoCode(value: string) {
  return normalizedCodePattern.test(value);
}

export function promoCodeField(
  definition: RegistrationFormDefinition,
): RegistrationFormField | null {
  return definition.sections
    .flatMap((section) => section.fields)
    .find((field) => (
      field.key === "promo_code"
      && field.scope === "REGISTRATION"
      && field.type === "TEXT"
    )) ?? null;
}

/** A code with a non-empty list is restricted to those attendee types; an empty or missing list applies to everyone. */
export function isAttendeeTypeRestricted(codes: readonly string[] | null | undefined): codes is readonly string[] {
  return Boolean(codes && codes.length > 0);
}

/**
 * Whether a code with this restriction applies to an attendee of this type. Unrestricted codes apply to everyone; a
 * restricted code applies only to an attendee whose type code is listed. An attendee with no type never matches, and a
 * listed code whose type was removed matches nobody (a restriction narrows, it never widens).
 */
export function promoAppliesToAttendeeType(
  allowedCodes: readonly string[] | null | undefined,
  attendeeTypeCode: string | null | undefined,
) {
  if (!isAttendeeTypeRestricted(allowedCodes)) return true;
  return typeof attendeeTypeCode === "string" && attendeeTypeCode !== "" && allowedCodes.includes(attendeeTypeCode);
}

/**
 * The attendees (by index, as in `FormCalculation.lineItems[].attendeeIndex`) a restricted code applies to. Attendees
 * beyond the typed list have no type and never match.
 */
export function eligibleAttendeeIndexes(
  allowedCodes: readonly string[],
  attendeeTypeCodes: ReadonlyArray<string | null>,
  attendeeCount = attendeeTypeCodes.length,
) {
  const indexes = new Set<number>();
  for (let index = 0; index < attendeeCount; index += 1) {
    if (promoAppliesToAttendeeType(allowedCodes, attendeeTypeCodes[index] ?? null)) indexes.add(index);
  }
  return indexes;
}

/**
 * The subtotal a restricted registration-level code may discount: the sum of the line items that belong to an attendee of
 * an allowed type. Lines with no attendee (lodging, registration-level fees) are left out. Never negative. For an unrestricted code this is not used: the whole subtotal is eligible, as before.
 */
export function restrictedEligibleSubtotalCents(
  calculation: FormCalculation,
  allowedCodes: readonly string[],
  attendeeTypeCodes: ReadonlyArray<string | null>,
) {
  const eligible = eligibleAttendeeIndexes(allowedCodes, attendeeTypeCodes);
  const total = calculation.lineItems
    .filter((line) => typeof line.attendeeIndex === "number" && eligible.has(line.attendeeIndex))
    .reduce((sum, line) => sum + line.amountCents, 0);
  return Math.max(0, Math.round(total));
}

type AttendeeScopeResolution =
  | { ok: true; eligibleSubtotalCents: number }
  | { ok: false; message: string };

/** The subtotal a code is judged on once its attendee-type restriction is applied, or why it does not apply. */
function resolveAttendeeScope(
  rule: PromoCodeRule,
  eligibleSubtotalCents: number,
  scope: PromoAttendeeScope | undefined,
): AttendeeScopeResolution {
  const allowed = rule.attendeeTypeCodes;
  if (!isAttendeeTypeRestricted(allowed)) return { ok: true, eligibleSubtotalCents };
  if (!scope) {
    // Fail closed: a restricted code is never judged without knowing who it is for.
    return { ok: false, message: `${rule.code} applies only to specific attendee types.` };
  }
  if (scope.kind === "ATTENDEE") {
    return promoAppliesToAttendeeType(allowed, scope.attendeeTypeCode)
      ? { ok: true, eligibleSubtotalCents }
      : { ok: false, message: `${rule.code} doesn't apply to this attendee type.` };
  }
  const anyone = eligibleAttendeeIndexes(allowed, scope.attendeeTypeCodes);
  if (anyone.size === 0) {
    return { ok: false, message: `${rule.code} doesn't apply to anyone on this registration.` };
  }
  return {
    ok: true,
    eligibleSubtotalCents: restrictedEligibleSubtotalCents(scope.calculation, allowed, scope.attendeeTypeCodes),
  };
}

export function evaluatePromoCode(
  rule: PromoCodeRule | null,
  input: {
    submittedCode: string;
    eligibleSubtotalCents: number;
    pricingDate: string;
    /** Church-billed events never show a registrant an amount (#621). */
    hideAmounts?: boolean;
    /** Whom the code is for; required to use a code that is restricted to attendee types (#102). */
    attendeeScope?: PromoAttendeeScope;
  },
): PromoCodeEvaluation {
  const normalizedCode = normalizePromoCode(input.submittedCode);
  if (!isNormalizedPromoCode(normalizedCode)) {
    return {
      valid: false,
      reason: "INVALID_FORMAT",
      message: "Enter a promo code using 3–32 letters, numbers, hyphens, or underscores.",
    };
  }
  if (!rule || rule.normalizedCode !== normalizedCode) {
    return {
      valid: false,
      reason: "NOT_FOUND",
      message: "That promo code was not recognized. Check the spelling and try again.",
    };
  }
  if (!rule.isActive) {
    return {
      valid: false,
      reason: "INACTIVE",
      message: "That promo code is no longer active.",
    };
  }
  if (rule.startsOn && input.pricingDate < rule.startsOn) {
    return {
      valid: false,
      reason: "NOT_STARTED",
      message: `That promo code can be used starting ${rule.startsOn}.`,
    };
  }
  if (rule.endsOn && input.pricingDate > rule.endsOn) {
    return {
      valid: false,
      reason: "ENDED",
      message: `That promo code ended on ${rule.endsOn}.`,
    };
  }
  if (
    rule.maximumUses !== null
    && rule.redeemedCount >= rule.maximumUses
  ) {
    return {
      valid: false,
      reason: "USE_LIMIT_REACHED",
      message: "That promo code has reached its use limit.",
    };
  }

  const scoped = resolveAttendeeScope(rule, input.eligibleSubtotalCents, input.attendeeScope);
  if (!scoped.ok) {
    return {
      valid: false,
      reason: "ATTENDEE_TYPE_NOT_ELIGIBLE",
      message: scoped.message,
    };
  }
  const eligibleSubtotalCents = Math.max(
    0,
    Math.round(scoped.eligibleSubtotalCents),
  );
  if (
    rule.minimumSubtotalCents !== null
    && eligibleSubtotalCents < rule.minimumSubtotalCents
  ) {
    return {
      valid: false,
      reason: "MINIMUM_NOT_MET",
      message: input.hideAmounts
        ? "This promo code's minimum isn't met for this registration."
        : isAttendeeTypeRestricted(rule.attendeeTypeCodes) && input.attendeeScope?.kind === "REGISTRATION"
          ? `That promo code requires at least ${formatCents(rule.minimumSubtotalCents)} for the attendees it applies to. Their subtotal is ${formatCents(eligibleSubtotalCents)}.`
          : `That promo code requires a subtotal of at least ${formatCents(rule.minimumSubtotalCents)}. Your current subtotal is ${formatCents(eligibleSubtotalCents)}.`,
    };
  }
  if (eligibleSubtotalCents === 0) {
    return {
      valid: false,
      reason: "NO_ELIGIBLE_SUBTOTAL",
      message: "Choose a priced registration option before applying this promo code.",
    };
  }

  const rawDiscount = rule.discountType === "FIXED_CENTS"
    ? rule.discountValue
    : Math.floor(eligibleSubtotalCents * rule.discountValue / 10_000);
  const cappedDiscount = rule.discountType === "PERCENT_BPS"
    && rule.maximumDiscountCents !== null
    ? Math.min(rawDiscount, rule.maximumDiscountCents)
    : rawDiscount;
  const discountAmountCents = Math.min(
    eligibleSubtotalCents,
    Math.max(0, Math.round(cappedDiscount)),
  );

  return {
    valid: true,
    code: rule.code,
    normalizedCode,
    eligibleSubtotalCents,
    discountAmountCents,
  };
}

export function processingFeeForDiscountedSubtotal(
  definition: RegistrationFormDefinition,
  registrationResponses: Record<string, unknown>,
  discountedSubtotalCents: number,
) {
  const payment = definition.payment;
  const cardSelected = Boolean(
    payment?.enabled
    && registrationResponses[payment.paymentMethodFieldKey]
      === payment.cardOptionValue,
  );
  if (
    !payment?.passFeeToRegistrant
    || !cardSelected
    || discountedSubtotalCents <= 0
  ) {
    return 0;
  }
  const rate = payment.percentageBasisPoints / 10_000;
  const grossTotal = Math.ceil(
    (discountedSubtotalCents + payment.fixedFeeCents) / (1 - rate),
  );
  return Math.max(0, grossTotal - discountedSubtotalCents);
}

export function applyPromoCodeToCalculation(
  definition: RegistrationFormDefinition,
  registrationResponses: Record<string, unknown>,
  calculation: FormCalculation,
  evaluation: Extract<PromoCodeEvaluation, { valid: true }>,
): DiscountedFormCalculation {
  const preDiscountSubtotalCents = Math.max(
    0,
    calculation.subtotalCents,
  );
  const discountAmountCents = Math.min(
    preDiscountSubtotalCents,
    Math.max(0, evaluation.discountAmountCents),
  );
  const subtotalCents = Math.max(
    0,
    preDiscountSubtotalCents - discountAmountCents,
  );
  const processingFeeCents = processingFeeForDiscountedSubtotal(
    definition,
    registrationResponses,
    subtotalCents,
  );
  return {
    ...calculation,
    preDiscountSubtotalCents,
    discountAmountCents,
    promoCode: evaluation.code,
    subtotalCents,
    processingFeeCents,
    totalCents: subtotalCents + processingFeeCents,
  };
}


/**
 * A promo code field asked of each attendee (#397): codes are per person, so
 * a form has either this or the registration-level field, never both (field
 * keys are unique).
 */
export function attendeePromoCodeField(
  definition: RegistrationFormDefinition,
): RegistrationFormField | null {
  return definition.sections
    .flatMap((section) => section.fields)
    .find((field) => (
      field.key === "promo_code"
      && field.scope === "ATTENDEE"
      && field.type === "TEXT"
    )) ?? null;
}

/** One person's share of a roster calculation: their own line items. */
export function attendeeShareCents(calculation: FormCalculation, attendeeIndex: number) {
  return Math.max(0, calculation.lineItems
    .filter((line) => line.attendeeIndex === attendeeIndex)
    .reduce((total, line) => total + line.amountCents, 0));
}

export type AttendeePromoDiscount = {
  attendeeIndex: number;
  code: string;
  discountAmountCents: number;
  /** Known once the use is claimed at submission. */
  promoCodeId?: string;
};

/** Applies per-person discounts, each already limited to that person's share. */
export function applyAttendeePromoCodes(
  definition: RegistrationFormDefinition,
  registrationResponses: Record<string, unknown>,
  calculation: FormCalculation,
  discounts: readonly AttendeePromoDiscount[],
): DiscountedFormCalculation & { attendeeDiscounts: AttendeePromoDiscount[] } {
  const preDiscountSubtotalCents = Math.max(0, calculation.subtotalCents);
  const discountAmountCents = Math.min(
    preDiscountSubtotalCents,
    discounts.reduce((total, discount) => total + Math.max(0, discount.discountAmountCents), 0),
  );
  const subtotalCents = preDiscountSubtotalCents - discountAmountCents;
  const processingFeeCents = processingFeeForDiscountedSubtotal(definition, registrationResponses, subtotalCents);
  return {
    ...calculation,
    preDiscountSubtotalCents,
    discountAmountCents,
    promoCode: [...new Set(discounts.map((discount) => discount.code))].join(", "),
    subtotalCents,
    processingFeeCents,
    totalCents: subtotalCents + processingFeeCents,
    attendeeDiscounts: [...discounts],
  };
}

export type HeldPromoCode = { normalizedCode: string; sponsored: boolean };

/**
 * A church-sponsored code is the only code on its registration (church group registration, #961). Several people may use
 * that same code (each counts as one use), but a different church code, or any other code beside a church code, is refused.
 * Different non-church codes stay allowed (per-person codes, #397). Returns the message for a code that conflicts with a
 * code already held on the registration, or null.
 */
export function promoCodeConflictMessage(held: readonly HeldPromoCode[], next: HeldPromoCode) {
  const other = held.find((code) => code.normalizedCode !== next.normalizedCode && (code.sponsored || next.sponsored));
  if (!other) return null;
  return `A church-sponsored code can't be combined with another promo code on one registration. ${other.normalizedCode} is already used for another person here.`;
}
