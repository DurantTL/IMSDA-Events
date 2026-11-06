import { describe, expect, it } from "vitest";
import { describeRate } from "@/modules/lodging/domain";
import { chargeChangeSentence } from "@/modules/lodging/preferences-domain";
import { formatCents } from "@/modules/payments/format-cents";
import { formatCardMoney } from "@/modules/event-info-cards/domain";
import { formatPdfMoney } from "@/modules/invoices/invoice-pdf";
import { formatCents as formatCloseoutCents } from "@/modules/meals/closeout";
import { churchSponsorFlagLabel, signedMoney } from "@/modules/promo-codes/church-sponsor-flag-label";
import { formatMerchandiseMoney } from "@/components/merchandise-admin-ui";
import { invoiceMoney } from "@/components/invoices";

const cases: Array<[number, string]> = [
  [0, "$0.00"],
  [5, "$0.05"],
  [123456, "$1,234.56"],
  [100000000, "$1,000,000.00"],
  [-500, "-$5.00"],
];

describe("shared money helpers keep their output (#1363)", () => {
  it.each(cases)("prints %i cents the Intl way in the re-pointed helpers", (cents, text) => {
    expect(formatCardMoney(cents)).toBe(text);
    expect(formatPdfMoney(cents)).toBe(text);
    expect(formatMerchandiseMoney(cents)).toBe(text);
    expect(invoiceMoney(cents)).toBe(text);
  });

  it("keeps the closeout helper in the plain form", () => {
    expect(formatCloseoutCents(123456)).toBe("$1234.56");
    expect(formatCloseoutCents(-500)).toBe("-$5.00");
    expect(formatCloseoutCents(-0)).toBe("$0.00");
  });

  it("keeps the church sponsor sign handling over the absolute amount", () => {
    expect(signedMoney(123456)).toBe("+$1,234.56");
    expect(signedMoney(-500)).toBe("-$5.00");
  });

  it("prints church sponsor shares as absolute amounts", () => {
    expect(churchSponsorFlagLabel({ shareCents: -500, reviewedShareCents: -123456, deltaCents: 5 })).toBe(
      "Church share now $5.00; finance reviewed $1,234.56 (difference +$0.05 not applied)",
    );
    expect(churchSponsorFlagLabel({ shareCents: -0, reviewedShareCents: -0, deltaCents: 0 })).toBe(
      "Church share now $0.00; finance reviewed $0.00 (difference +$0.00 not applied)",
    );
  });
});

describe("lodging and WR26 money text keeps its output (#1363)", () => {
  // The expressions these call sites used before they were folded into formatCents.
  const legacyPlain = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const legacySigned = (cents: number) => `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const nonNegative = [0, 1, 5, 99, 100, 101, 105, 995, 1005, 12345, 99999, 100000, 123456, 100000000, 1_000_000];
  const signed = [...nonNegative, -1, -5, -500, -123456];

  it.each(nonNegative)("prints %i cents like the old plain expression (no separators)", (cents) => {
    expect(formatCents(cents, { grouping: false })).toBe(legacyPlain(cents));
    expect(describeRate({ amountCents: cents, basis: "PER_PERSON_NIGHT", minimumNights: null })).toBe(`${legacyPlain(cents)} per person per night`);
  });

  it("keeps the rate sentence, including the minimum nights", () => {
    expect(describeRate({ amountCents: 123456, basis: "PER_UNIT_NIGHT", minimumNights: 2 })).toBe("$1234.56 per room or site per night, 2+ nights");
  });

  it.each(signed)("prints the signed list change for %i cents like the old expression", (cents) => {
    expect(chargeChangeSentence({ chargeDeltaCents: cents })).toContain(legacySigned(cents));
  });

  it("differs from the old plain expression only for negatives, which is why the local dollars helpers stay", () => {
    expect(legacyPlain(-500)).toBe("$-5.00");
    expect(formatCents(-500, { grouping: false })).toBe("-$5.00");
  });
});
