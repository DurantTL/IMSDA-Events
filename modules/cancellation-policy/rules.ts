import { z } from "zod";

/**
 * Versioned cancellation rules for one event (#169). This file is the shape of a policy version and nothing else:
 * no database, no clock, no money movement. `calculator.ts` evaluates it; `repository.ts` stores it.
 *
 * A version is immutable once saved. Changing the rules means saving a new version with its own effective date; every
 * calculation copies the exact rules it used, so a later change can never rewrite an earlier outcome.
 *
 * The display-only refund policy text (`Event.refundPolicy`, #891) is separate and untouched by anything here.
 */

export const RULES_SCHEMA_VERSION = 1;

/**
 * What a charge entry is, so a policy can treat classes of charge differently. Form price lines default to
 * REGISTRATION; a policy re-classifies specific form fields (a meal plan, a lodging line) with `classifications`.
 * MERCHANDISE comes from merchandise orders, FEE from card processing fees on the registration, ADJUSTMENT from staff
 * adjustments and promo discounts, TAX from order taxes. Meals and issued items are not modelled yet (#210, #213);
 * MEAL and LODGING are available now through `classifications` and will classify those lines when they land.
 */
export const chargeCategories = ["REGISTRATION", "MEAL", "LODGING", "MERCHANDISE", "FEE", "TAX", "ADJUSTMENT", "OTHER"] as const;
export type ChargeCategory = typeof chargeCategories[number];

/** Categories a staff classification may assign to a form field. The rest are decided by where the charge came from. */
export const classifiableCategories = ["REGISTRATION", "MEAL", "LODGING", "MERCHANDISE", "OTHER"] as const;

export const cancellationScopes = ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"] as const;
export type CancellationScope = typeof cancellationScopes[number];

export const cardFeeTreatments = ["REFUNDABLE", "NONREFUNDABLE"] as const;
export type CardFeeTreatment = typeof cardFeeTreatments[number];

export const depositTreatments = ["REFUND", "FORFEIT"] as const;
export type DepositTreatment = typeof depositTreatments[number];

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-05-25.").refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, "That is not a real calendar date.");

const label = z.string().trim().min(1, "Enter a label.").max(80);
const fieldKey = z.string().trim().min(1).max(80);
const money = z.number().int().min(0).max(100_000_000);

export const refundShareSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FULL") }).strict(),
  z.object({ kind: z.literal("PERCENT"), percent: z.number().int().min(1, "Use 1 to 99; choose Full or No refund for the ends.").max(99) }).strict(),
  z.object({ kind: z.literal("NONE") }).strict(),
]);
export type RefundShare = z.infer<typeof refundShareSchema>;

/**
 * What happens to the money when a cancellation falls in a window (or after the last one, or is a no-show).
 * - `refund`: the share of each refundable charge that is eligible; nonrefundable components are withheld outright.
 * - `flatWithholdCents`: a fixed amount taken out of what would be refunded (the Camp Meeting processing fee), never
 *   more than the eligible amount, so it can only reduce a refund to $0 and never create a charge.
 * - `depositTreatment`: FORFEIT keeps the reservation deposit (it is part of what is paid, so only paid money can be
 *   kept); REFUND returns it with everything else. The deposit belongs to the registration, never to a person, so it
 *   is only forfeited when the whole registration is cancelled.
 * - `creditAllowed`: whether the registrant may be offered future-event credit instead of a refund.
 */
export const cancellationTermsSchema = z.object({
  refund: refundShareSchema,
  flatWithholdCents: money.default(0),
  flatWithholdLabel: label.default("Processing fee"),
  depositTreatment: z.enum(depositTreatments).default("REFUND"),
  creditAllowed: z.boolean().default(false),
}).strict();
export type CancellationTerms = z.infer<typeof cancellationTermsSchema>;

export const cancellationWindowSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/, "Use lowercase letters, numbers and hyphens."),
  label,
  /**
   * The last local calendar day (in the event's time zone) the window covers. The whole day counts: the window ends
   * at the next local midnight, so 2026-05-25 includes 11:59:59.999 PM on May 25 and excludes 12:00 AM on May 26.
   */
  endsOn: dateKey,
  terms: cancellationTermsSchema,
}).strict();
export type CancellationWindow = z.infer<typeof cancellationWindowSchema>;

export const cancellationRulesSchema = z.object({
  schema: z.literal(RULES_SCHEMA_VERSION).default(RULES_SCHEMA_VERSION),
  /** Earliest first. A cancellation takes the first window it falls inside. */
  windows: z.array(cancellationWindowSchema).max(12),
  /** Applies once every window has passed. Required, so a late cancellation always has a stated outcome. */
  afterWindows: z.object({ label, terms: cancellationTermsSchema }).strict(),
  /** Applies instead of any window when staff record that the registrant did not arrive for the first night. */
  noShow: z.object({ label, terms: cancellationTermsSchema }).strict().nullable().default(null),
  allowedScopes: z.array(z.enum(cancellationScopes)).min(1).default([...cancellationScopes]),
  /** Which charge entries may be cancelled one at a time under the COMPONENT scope. */
  supportedComponents: z.object({
    categories: z.array(z.enum(chargeCategories)).max(chargeCategories.length).default([]),
    fieldKeys: z.array(fieldKey).max(40).default([]),
  }).strict().default({ categories: [], fieldKeys: [] }),
  /** Form price fields that are meals, lodging, merchandise or other, rather than plain registration. */
  classifications: z.array(z.object({
    category: z.enum(classifiableCategories),
    fieldKeys: z.array(fieldKey).min(1).max(40),
  }).strict()).max(20).default([]),
  /** Never refundable, by category or by form field. Withheld in full whatever window applies. */
  nonrefundable: z.object({
    categories: z.array(z.enum(chargeCategories)).max(chargeCategories.length).default([]),
    fieldKeys: z.array(fieldKey).max(40).default([]),
  }).strict().default({ categories: [], fieldKeys: [] }),
  /**
   * The card processing fee already on the registration (what the registrant paid on top of the price to use a
   * card). REFUNDABLE follows the window like the charge it was added to; NONREFUNDABLE withholds it in full.
   * Either way it is shown on its own line, and it is the registration's fee, never a person's, so a one-person
   * cancellation carries only that person's share of it.
   */
  cardFeeTreatment: z.enum(cardFeeTreatments),
}).strict().superRefine((rules, context) => {
  const seenIds = new Set<string>();
  rules.windows.forEach((window, index) => {
    if (seenIds.has(window.id)) context.addIssue({ code: "custom", path: ["windows", index, "id"], message: "Window ids must be unique." });
    seenIds.add(window.id);
    const previous = rules.windows[index - 1];
    if (previous && window.endsOn <= previous.endsOn) {
      context.addIssue({ code: "custom", path: ["windows", index, "endsOn"], message: "Windows must end on later dates, earliest first." });
    }
  });
  const classified = new Set<string>();
  rules.classifications.forEach((entry, index) => entry.fieldKeys.forEach((key) => {
    if (classified.has(key)) context.addIssue({ code: "custom", path: ["classifications", index, "fieldKeys"], message: `${key} is classified twice.` });
    classified.add(key);
  }));
});
export type CancellationRules = z.infer<typeof cancellationRulesSchema>;

export type CancellationRulesInput = z.input<typeof cancellationRulesSchema>;

export function parseCancellationRules(value: unknown): CancellationRules {
  return cancellationRulesSchema.parse(value);
}

export function formatCents(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** The terms in plain words, for the staff screen and the result's explanation lines. */
export function describeTerms(terms: CancellationTerms) {
  const parts: string[] = [];
  if (terms.refund.kind === "FULL") parts.push("full refund");
  else if (terms.refund.kind === "NONE") parts.push("no refund");
  else parts.push(`${terms.refund.percent}% refund`);
  if (terms.flatWithholdCents > 0) parts.push(`minus a ${formatCents(terms.flatWithholdCents)} ${terms.flatWithholdLabel.toLowerCase()}`);
  parts.push(terms.depositTreatment === "FORFEIT" ? "deposit forfeited" : "deposit refunded");
  if (terms.creditAllowed) parts.push("future-event credit may be offered");
  return parts.join(", ");
}

/**
 * The Camp Meeting 2026 rule (issue #169 comment): before the deadline a full refund minus a $10 processing fee;
 * after it, or for a no-show on the first night, the deposit is forfeited and the reservation cancelled. Offered as a
 * starting point in the staff screen: a human reviews and saves it, and nothing is saved from here.
 *
 * Two readings are chosen and flagged for the owner: only the deposit is forfeited after the deadline (anything paid
 * beyond it stays refundable), and the card fee follows the window.
 */
export function campMeetingPreset(deadlineDate: string): CancellationRulesInput {
  const forfeit: CancellationTerms = {
    refund: { kind: "FULL" },
    flatWithholdCents: 0,
    flatWithholdLabel: "Processing fee",
    depositTreatment: "FORFEIT",
    creditAllowed: false,
  };
  return {
    schema: RULES_SCHEMA_VERSION,
    windows: [{
      id: "before-deadline",
      label: "Before the deadline",
      endsOn: deadlineDate,
      terms: { refund: { kind: "FULL" }, flatWithholdCents: 1000, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: false },
    }],
    afterWindows: { label: "After the deadline", terms: forfeit },
    noShow: { label: "No-show on the first night", terms: forfeit },
    allowedScopes: ["FULL_REGISTRATION", "ATTENDEE"],
    supportedComponents: { categories: [], fieldKeys: [] },
    classifications: [],
    nonrefundable: { categories: [], fieldKeys: [] },
    cardFeeTreatment: "REFUNDABLE",
  };
}
