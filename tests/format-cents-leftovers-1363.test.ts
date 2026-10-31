import { describe, expect, it } from "vitest";
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
