import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/registrations/repository", () => ({ getRegistrationById: vi.fn() }));
vi.mock("@/modules/promo-codes/repository", () => ({
  claimPromoCode: vi.fn(), PublicPromoCodeError: class extends Error {}, PromoCodeOperationError: class extends Error {},
}));

import { createAdjustmentSchema } from "@/modules/registrations/adjustments";
import { toCsv } from "@/modules/reporting/csv";
import {
  createContributionSchema,
  fundAwardSchema,
  fundCsvRows,
  fundTotals,
  normalizeSponsorName,
  reverseContributionSchema,
  sponsorKey,
  summarizeFund,
  type AwardLine,
  type ContributionLine,
} from "@/modules/scholarship-funds/domain";

const contribution = (overrides: Partial<ContributionLine> = {}): ContributionLine => ({
  id: "c1", sponsorKey: "org:church-a", sponsorName: "Test Church A", organizationId: "church-a", amountCents: 50_000, ...overrides,
});
const award = (overrides: Partial<AwardLine> = {}): AwardLine => ({
  id: "a1", sponsorKey: "org:church-a", sponsorName: "Test Church A", organizationId: "church-a", amountCents: 10_000,
  pledged: false, settled: false, active: true, ...overrides,
});

describe("sponsor identity", () => {
  it("prefers the directory organization, else the normalized typed name", () => {
    expect(sponsorKey({ organizationId: "church-a", name: "Whatever" })).toBe("org:church-a");
    expect(sponsorKey({ name: "  The  Smith   Family " })).toBe("name:the smith family");
    expect(sponsorKey({ name: "THE SMITH FAMILY" })).toBe(sponsorKey({ name: "the smith family" }));
    expect(normalizeSponsorName("Ａｎｎｅ")).toBe("anne");
  });
});

describe("fund totals and the matching view (#398)", () => {
  it("balance is received minus funded awards, and pledged awards sit outside it", () => {
    const summary = summarizeFund(
      [contribution({ amountCents: 50_000 }), contribution({ id: "c2", amountCents: 20_000 })],
      [award({ amountCents: 15_000 }), award({ id: "a2", amountCents: 8_000, pledged: true })],
    );
    expect(summary).toMatchObject({ receivedCents: 70_000, fundedCents: 15_000, pledgedCents: 8_000, balanceCents: 55_000, afterPledgesCents: 47_000 });
  });

  it("a reversal line removes money; a reversed award stops counting", () => {
    const summary = summarizeFund(
      [contribution({ amountCents: 50_000 }), contribution({ id: "c1r", amountCents: -50_000 })],
      [award({ active: false }), award({ id: "a2", pledged: true, active: false })],
    );
    expect(summary).toMatchObject({ receivedCents: 0, fundedCents: 0, pledgedCents: 0, balanceCents: 0 });
    expect(summary.sponsors).toEqual([expect.objectContaining({ receivedCents: 0, awardedCents: 0, outstandingCents: 0 })]);
  });

  it("a settled pledge becomes a funded award and is no longer outstanding", () => {
    const summary = summarizeFund([contribution({ amountCents: 20_000 })], [award({ pledged: true, settled: true, amountCents: 20_000 })]);
    expect(summary).toMatchObject({ fundedCents: 20_000, pledgedCents: 0, balanceCents: 0 });
    expect(summary.sponsors[0]).toMatchObject({ awardedCents: 20_000, outstandingCents: 0 });
  });

  it("shows what is still outstanding per sponsor, most outstanding first, and the fund short once pledges exceed the balance", () => {
    const summary = summarizeFund(
      [contribution({ amountCents: 10_000 })],
      [
        award({ id: "a1", sponsorKey: "name:sponsor b", sponsorName: "Sponsor B", organizationId: null, amountCents: 30_000, pledged: true }),
        award({ id: "a2", sponsorKey: "name:sponsor c", sponsorName: "Sponsor C", organizationId: null, amountCents: 5_000, pledged: true }),
        award({ id: "a3", amountCents: 4_000 }),
      ],
    );
    expect(summary.sponsors.map((sponsor) => [sponsor.name, sponsor.receivedCents, sponsor.awardedCents, sponsor.outstandingCents])).toEqual([
      ["Sponsor B", 0, 0, 30_000],
      ["Sponsor C", 0, 0, 5_000],
      ["Test Church A", 10_000, 4_000, 0],
    ]);
    expect(summary.sponsors[2]!.unallocatedCents).toBe(6_000);
    expect(summary.afterPledgesCents).toBe(10_000 - 4_000 - 35_000);
  });

  it("an award with no sponsor draws on the fund without appearing under one", () => {
    const summary = summarizeFund([contribution()], [award({ sponsorKey: null, sponsorName: null, organizationId: null })]);
    expect(summary.fundedCents).toBe(10_000);
    expect(summary.sponsors).toHaveLength(1);
  });

  it("fundTotals keeps integer cents", () => {
    expect(fundTotals(1_001, 1, 500)).toEqual({ receivedCents: 1_001, fundedCents: 1, pledgedCents: 500, balanceCents: 1_000, afterPledgesCents: 500 });
  });
});

describe("input schemas", () => {
  const base = { amountCents: 2_500, receivedOn: "2027-01-15", method: "CHECK" as const };

  it("a contribution names a directory church or a typed sponsor, in whole cents, on a real date", () => {
    expect(createContributionSchema.safeParse({ ...base, organizationId: "church-a" }).success).toBe(true);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A friend" }).success).toBe(true);
    expect(createContributionSchema.safeParse(base).success).toBe(false);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A", amountCents: 0 }).success).toBe(false);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A", amountCents: 12.5 }).success).toBe(false);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A", amountCents: -100 }).success).toBe(false);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A", receivedOn: "2027-02-30" }).success).toBe(false);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A", method: "CRYPTO" }).success).toBe(false);
    expect(createContributionSchema.safeParse({ ...base, sponsorName: "A", extra: true }).success).toBe(false);
  });

  it("a reversal needs a reason", () => {
    expect(reverseContributionSchema.safeParse({ reason: "ab" }).success).toBe(false);
    expect(reverseContributionSchema.safeParse({ reason: "Check bounced" }).success).toBe(true);
  });

  it("a pledged fund award must name who pledged it", () => {
    expect(fundAwardSchema.safeParse({ pledged: true }).success).toBe(false);
    expect(fundAwardSchema.safeParse({ pledged: true, sponsorName: "Test Church" }).success).toBe(true);
    expect(fundAwardSchema.parse({})).toEqual({ pledged: false });
  });

  it("only a scholarship can draw on the fund", () => {
    const scholarship = { kind: "SCHOLARSHIP", amountCents: 5_000, reason: "Committee approved", fundAward: { pledged: false } };
    expect(createAdjustmentSchema.safeParse(scholarship).success).toBe(true);
    expect(createAdjustmentSchema.safeParse({ ...scholarship, kind: "DISCOUNT" }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ ...scholarship, kind: "CORRECTION", amountCents: -5_000 }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ kind: "DISCOUNT", amountCents: 5_000, reason: "Committee approved" }).success).toBe(true);
  });
});

describe("finance export", () => {
  const summary = summarizeFund(
    [contribution({ sponsorName: "=HYPERLINK(\"http://example.test\")", amountCents: 10_000 })],
    [award({ amountCents: 4_000, pledged: true })],
  );
  const csv = toCsv(fundCsvRows({
    eventName: "Test Event",
    summary,
    contributions: [
      { id: "c1", receivedOn: "2027-01-15", sponsorName: "=HYPERLINK(\"http://example.test\")", method: "CHECK", amountCents: 10_000, reversesContributionId: null, note: "+1 check 1001" },
      { id: "c1r", receivedOn: "2027-01-20", sponsorName: "Test Church A", method: "CHECK", amountCents: -2_500, reversesContributionId: "c1", note: "-bounced" },
    ],
    awards: [{ id: "a1", confirmationCode: "REG-1", sponsorName: "@cmd", amountCents: 4_000, pledged: true, settled: false, active: true, createdOn: "2027-01-16" }],
  }));

  it("neutralizes formulas in sponsor names and notes through csvCell", () => {
    expect(csv).toContain(`"'=HYPERLINK(""http://example.test"")"`);
    expect(csv).toContain(`"'+1 check 1001"`);
    expect(csv).toContain(`"'-bounced"`);
    expect(csv).toContain(`"'@cmd"`);
    expect(csv).not.toMatch(/(^|,)"[=+\-@]/m);
  });

  it("writes unsigned dollars with the direction in a column, and the summary figures", () => {
    expect(csv).toContain('"Reversal"');
    expect(csv).toContain('"25.00"');
    expect(csv).toContain('"Balance","100.00"');
    expect(csv).toContain('"Pledged, not yet received","40.00"');
    expect(csv).toContain('"Pledged, not yet received"\r\n');
  });
});
