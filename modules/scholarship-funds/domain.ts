import { z } from "zod";

/**
 * Event scholarship funds (#398), pure rules.
 *
 * Decision (owner, Oct 14, 2026): one scholarship fund per event. Contributions
 * and awards belong to that event's fund, and nothing carries over to another
 * event or year. Money is integer cents throughout. This records money; it
 * never moves any (no refund, payment, or transfer happens here).
 *
 * Words used below:
 * - received: contribution lines summed, reversals included (they are negative).
 * - funded awards: active awards that are not pledged, plus pledged ones staff
 *   have settled. They are drawn from received money, so received minus funded
 *   is the balance, and a funded award can never take it below zero.
 * - pledged awards: active awards marked "pledged, not yet received". The money
 *   is promised by a named sponsor but has not arrived, so they may exceed the
 *   balance. They are what is outstanding for that sponsor until settled.
 * - active: the award's scholarship adjustment line has not been reversed.
 */

export const CONTRIBUTION_METHODS = ["CASH", "CHECK", "CARD", "BANK_TRANSFER", "OTHER"] as const;
export type ContributionMethod = (typeof CONTRIBUTION_METHODS)[number];

export const contributionMethodLabels: Record<ContributionMethod, string> = {
  CASH: "Cash",
  CHECK: "Check",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

const MAX_CENTS = 100_000_000;

export type ScholarshipFundErrorCode =
  | "SPONSOR_REQUIRED"
  | "SPONSOR_NOT_FOUND"
  | "FUND_BALANCE_TOO_LOW"
  | "CONTRIBUTION_NOT_FOUND"
  | "CONTRIBUTION_NOT_REVERSIBLE"
  | "CONTRIBUTION_ALREADY_REVERSED"
  | "REVERSAL_EXCEEDS_BALANCE"
  | "AWARD_NOT_FOUND"
  | "AWARD_NOT_PLEDGED"
  | "AWARD_ALREADY_SETTLED"
  | "AWARD_REVERSED"
  | "SETTLE_EXCEEDS_BALANCE";

export class ScholarshipFundError extends Error {
  constructor(public readonly code: ScholarshipFundErrorCode, message: string) {
    super(message);
    this.name = "ScholarshipFundError";
  }
}

export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** The text a sponsor is matched on: case, spacing and Unicode form never split one sponsor in two. */
export function normalizeSponsorName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * What groups a sponsor's lines: the directory organization's id when one was
 * chosen, otherwise the normalized free-text name. A directory church and the
 * same name typed by hand stay separate on purpose; staff pick the directory
 * entry to join them.
 */
export function sponsorKey(sponsor: { organizationId?: string | null; name: string }) {
  return sponsor.organizationId ? `org:${sponsor.organizationId}` : `name:${normalizeSponsorName(sponsor.name)}`;
}

const sponsorFields = {
  /** A church or group chosen from the shared directory (preferred). */
  organizationId: z.string().trim().min(1).max(64).optional(),
  /** Free text, for a person or group that is not in the directory. */
  sponsorName: z.string().trim().min(1, "Enter who it is from.").max(120).optional(),
};

export const createContributionSchema = z.object({
  ...sponsorFields,
  amountCents: z.number().int().min(1, "Enter an amount.").max(MAX_CENTS),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was received.").refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a real date."),
  method: z.enum(CONTRIBUTION_METHODS),
  note: z.string().trim().max(200).optional(),
}).strict().refine((value) => Boolean(value.organizationId || value.sponsorName), {
  message: "Choose a church from the directory or type who it is from.",
  path: ["sponsorName"],
});

export const reverseContributionSchema = z.object({
  reason: z.string().trim().min(3, "Enter a reason.").max(200),
}).strict();

/**
 * The fund part of a scholarship adjustment (#396): "draw this scholarship on
 * the event's fund". A pledge must say who pledged it.
 */
export const fundAwardSchema = z.object({
  pledged: z.boolean().default(false),
  ...sponsorFields,
}).strict().refine((value) => !value.pledged || Boolean(value.organizationId || value.sponsorName), {
  message: "Say who pledged the money.",
  path: ["sponsorName"],
});

export type CreateContributionInput = z.infer<typeof createContributionSchema>;
export type FundAwardInput = z.infer<typeof fundAwardSchema>;

export type ContributionLine = {
  id: string;
  sponsorKey: string;
  sponsorName: string;
  organizationId: string | null;
  /** Positive for a contribution, negative for the line that reverses one. */
  amountCents: number;
};

export type AwardLine = {
  id: string;
  sponsorKey: string | null;
  sponsorName: string | null;
  organizationId: string | null;
  /** Positive cents. */
  amountCents: number;
  pledged: boolean;
  settled: boolean;
  /** False once the scholarship adjustment line was reversed. */
  active: boolean;
};

export type SponsorMatch = {
  key: string;
  name: string;
  organizationId: string | null;
  receivedCents: number;
  /** Funded awards attributed to this sponsor. */
  awardedCents: number;
  /** Pledged, not yet received: what this sponsor still owes the fund. */
  outstandingCents: number;
  /** Received from this sponsor and not yet attributed to an award. */
  unallocatedCents: number;
};

export type FundTotals = {
  receivedCents: number;
  fundedCents: number;
  pledgedCents: number;
  /** received - funded. Never negative: funded awards are checked against it. */
  balanceCents: number;
  /** balance - pledged: negative while the fund is waiting on pledged money. */
  afterPledgesCents: number;
};

export type FundSummary = FundTotals & { sponsors: SponsorMatch[] };

export function isFundedAward(award: Pick<AwardLine, "active" | "pledged" | "settled">) {
  return award.active && (!award.pledged || award.settled);
}

export function isPledgedAward(award: Pick<AwardLine, "active" | "pledged" | "settled">) {
  return award.active && award.pledged && !award.settled;
}

export function fundTotals(receivedCents: number, fundedCents: number, pledgedCents: number): FundTotals {
  const balanceCents = receivedCents - fundedCents;
  return { receivedCents, fundedCents, pledgedCents, balanceCents, afterPledgesCents: balanceCents - pledgedCents };
}

/**
 * The matching view: contributions received against awards made, per sponsor
 * or church. Sorted with the most outstanding first, then by name.
 */
export function summarizeFund(contributions: ContributionLine[], awards: AwardLine[]): FundSummary {
  const sponsors = new Map<string, SponsorMatch>();
  const entry = (key: string, name: string, organizationId: string | null) => {
    let match = sponsors.get(key);
    if (!match) {
      match = { key, name, organizationId, receivedCents: 0, awardedCents: 0, outstandingCents: 0, unallocatedCents: 0 };
      sponsors.set(key, match);
    }
    return match;
  };
  let received = 0;
  for (const line of contributions) {
    received += line.amountCents;
    entry(line.sponsorKey, line.sponsorName, line.organizationId).receivedCents += line.amountCents;
  }
  let funded = 0;
  let pledged = 0;
  for (const award of awards) {
    const isFunded = isFundedAward(award);
    const isPledged = isPledgedAward(award);
    if (isFunded) funded += award.amountCents;
    if (isPledged) pledged += award.amountCents;
    if (!award.sponsorKey || !award.sponsorName || (!isFunded && !isPledged)) continue;
    const match = entry(award.sponsorKey, award.sponsorName, award.organizationId);
    if (isFunded) match.awardedCents += award.amountCents;
    if (isPledged) match.outstandingCents += award.amountCents;
  }
  const list = [...sponsors.values()].map((match) => ({ ...match, unallocatedCents: match.receivedCents - match.awardedCents }));
  list.sort((a, b) => b.outstandingCents - a.outstandingCents || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { ...fundTotals(received, funded, pledged), sponsors: list };
}

export type FundExportData = {
  eventName: string;
  summary: FundSummary;
  contributions: Array<{
    id: string; receivedOn: string; sponsorName: string; method: ContributionMethod; amountCents: number;
    reversesContributionId: string | null; note: string | null;
  }>;
  awards: Array<{
    id: string; confirmationCode: string; sponsorName: string | null; amountCents: number; pledged: boolean;
    settled: boolean; active: boolean; createdOn: string;
  }>;
};

/**
 * Unsigned dollars. A leading minus would be read as a formula, so `csvCell` would quote it as text; the export
 * names direction in a label or a Type column instead ("Reversal", "Short by").
 */
function dollars(cents: number) {
  const absolute = Math.abs(cents);
  return `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * The finance export (#398): sections for the summary, the matching view, the
 * contribution lines and the award lines. Names appear only as sponsor names a
 * finance manager typed or chose; no attendee name, birth date or health value
 * is ever read. Pass the rows to `toCsv`, which neutralizes formula injection
 * through `csvCell` (a sponsor named `=HYPERLINK(...)` is exported as text).
 */
export function fundCsvRows(data: FundExportData): Array<Array<string | number>> {
  const { summary } = data;
  const rows: Array<Array<string | number>> = [
    ["Scholarship fund", data.eventName],
    [],
    ["Summary", "Amount"],
    ["Received", dollars(summary.receivedCents)],
    ["Awarded from received money", dollars(summary.fundedCents)],
    ["Balance", dollars(summary.balanceCents)],
    ["Pledged, not yet received", dollars(summary.pledgedCents)],
    [summary.afterPledgesCents < 0 ? "Short once pledges are honored by" : "Balance after pledges", dollars(summary.afterPledgesCents)],
    [],
    ["Matching by sponsor", "Received", "Awarded", "Pledged, not yet received", "Received, not yet awarded"],
    ...summary.sponsors.map((sponsor) => [
      sponsor.name, dollars(sponsor.receivedCents), dollars(sponsor.awardedCents), dollars(sponsor.outstandingCents), dollars(Math.max(0, sponsor.unallocatedCents)),
    ]),
    [],
    ["Contribution", "Type", "Date received", "Sponsor", "Method", "Amount", "Reverses", "Note"],
    ...data.contributions.map((line) => [
      line.id, line.reversesContributionId ? "Reversal" : "Contribution", line.receivedOn, line.sponsorName,
      contributionMethodLabels[line.method], dollars(line.amountCents), line.reversesContributionId ?? "", line.note ?? "",
    ]),
    [],
    ["Award", "Registration", "Date", "Sponsor", "Amount", "Status"],
    ...data.awards.map((award) => [
      award.id, award.confirmationCode, award.createdOn, award.sponsorName ?? "", dollars(award.amountCents),
      !award.active ? "Reversed" : award.pledged ? (award.settled ? "Pledge received" : "Pledged, not yet received") : "Funded",
    ]),
  ];
  return rows;
}
