import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatBackfillReport, runLedgerBackfill } from "@/modules/ledger/backfill";

type Entry = { sourceType: string; sourceId: string; kind: string; amountCents: number };
type Row = {
  id: string; eventId: string; confirmationCode: string; totalAmount: string; submittedAt: Date | null; createdAt: Date;
  promoCodeRedemption: Record<string, unknown> | null; publicFormSubmission?: { pricingSnapshot: unknown } | null; operations: Array<Record<string, unknown>>; ledgerEntries: Entry[];
};

const snap = (total: number, discount = 0) => ({ registration: { totalAmountCents: total }, pricingSnapshot: { discountAmountCents: discount } });
const operation = (id: string, at: string, before: number, after: number, discount = 0) => ({
  id, createdAt: new Date(at), actorUserId: "user_1", actorAttendeeAccountId: null, actorPersonId: null, actorNameSnapshot: "Staff Sample",
  beforeSnapshot: snap(before, discount), afterSnapshot: snap(after, discount),
});
const row = (id: string, total: string, extra: Partial<Row> = {}): Row => ({
  id, eventId: "e1", confirmationCode: `C-${id}`, totalAmount: total, submittedAt: new Date("2027-01-10T10:00:00Z"), createdAt: new Date("2027-01-10T10:00:00Z"),
  promoCodeRedemption: null, operations: [], ledgerEntries: [], ...extra,
});
const redemption = (id: string, discount: number) => ({
  id, createdAt: new Date("2027-01-10T10:00:00Z"), codeSnapshot: "SAVE", discountTypeSnapshot: "FIXED_CENTS", discountValueSnapshot: discount,
  minimumSubtotalCentsSnapshot: null, maximumDiscountCentsSnapshot: null, eligibleSubtotalCents: 20_000, discountAmountCents: discount, pricingDate: "2027-01-10",
});

function fakeClient(rows: Row[]) {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<number>) => fn({
    registrationLedgerEntry: {
      createMany: vi.fn(async ({ data, skipDuplicates }: { data: Array<Record<string, unknown>>; skipDuplicates: boolean }) => {
        expect(skipDuplicates).toBe(true);
        let count = 0;
        for (const entry of data) {
          const target = rows.find((candidate) => candidate.id === entry.registrationId)!;
          const exists = target.ledgerEntries.some((existing) => existing.sourceType === entry.sourceType && existing.sourceId === entry.sourceId && existing.kind === entry.kind);
          if (exists) continue;
          target.ledgerEntries.push({ sourceType: String(entry.sourceType), sourceId: String(entry.sourceId), kind: String(entry.kind), amountCents: Number(entry.amountCents) });
          count += 1;
        }
        return { count };
      }),
    },
  }));
  return {
    transaction,
    client: {
      $transaction: transaction,
      registration: {
        findMany: vi.fn(async ({ where, take, cursor, skip }: { where: { eventId?: string }; take: number; cursor?: { id: string }; skip?: number }) => {
          const matching = rows.filter((candidate) => !where.eventId || candidate.eventId === where.eventId).sort((a, b) => a.id.localeCompare(b.id));
          const start = cursor ? matching.findIndex((candidate) => candidate.id === cursor.id) + (skip ?? 0) : 0;
          return matching.slice(start, start + take);
        }),
      },
    },
  };
}

describe("ledger backfill", () => {
  const history = () => [
    row("r1", "175.00"),
    row("r2", "175.00", { promoCodeRedemption: redemption("red2", 2_500) }),
    row("r3", "110.00", {
      promoCodeRedemption: redemption("red3", 2_000),
      operations: [operation("op1", "2027-02-01T10:00:00Z", 10_000, 16_000, 2_000), operation("op2", "2027-03-01T10:00:00Z", 16_000, 11_000, 2_000)],
    }),
    row("r4", "0.00", { submittedAt: null }),
    row("r5", "50.00", { ledgerEntries: [{ sourceType: "REGISTRATION_SUBMISSION", sourceId: "r5", kind: "CHARGE", amountCents: 5_000 }] }),
  ];

  it("a dry run reports what it would write and writes nothing", async () => {
    const rows = history();
    const { client, transaction } = fakeClient(rows);
    const report = await runLedgerBackfill(client as never, { apply: false });
    expect(transaction).not.toHaveBeenCalled();
    expect(report).toMatchObject({ apply: false, registrationsScanned: 5, registrationsWithMissingEntries: 4, entriesPlanned: 1 + 2 + 4 + 1, entriesWritten: 0, failures: [] });
    expect(report.entriesByKind).toEqual({ CHARGE: 5, DISCOUNT: 2, CREDIT: 1 });
    expect(report.residuals).toEqual([]);
    expect(rows.every((candidate) => candidate.ledgerEntries.length === (candidate.id === "r5" ? 1 : 0))).toBe(true);
    expect(formatBackfillReport(report)).toContain("DRY RUN");
  });

  it("applies, then writes nothing on every repeated run, so no entry is duplicated", async () => {
    const rows = history();
    const { client } = fakeClient(rows);
    const first = await runLedgerBackfill(client as never, { apply: true, batchSize: 2 });
    expect(first).toMatchObject({ entriesWritten: 8, registrationsScanned: 5, failures: [] });
    const sums = Object.fromEntries(rows.map((candidate) => [candidate.id, candidate.ledgerEntries.reduce((sum, entry) => sum + entry.amountCents, 0)]));
    expect(sums).toEqual({ r1: 17_500, r2: 17_500, r3: 11_000, r4: 0, r5: 5_000 });
    expect(rows.find((candidate) => candidate.id === "r3")!.ledgerEntries.map((entry) => `${entry.kind}:${entry.amountCents}`)).toEqual(["CHARGE:12000", "DISCOUNT:-2000", "CHARGE:6000", "CREDIT:-5000"]);
    expect(rows.find((candidate) => candidate.id === "r4")!.ledgerEntries).toEqual([expect.objectContaining({ kind: "CHARGE", amountCents: 0 })]);
    for (let run = 0; run < 2; run += 1) {
      const again = await runLedgerBackfill(client as never, { apply: true });
      expect(again).toMatchObject({ entriesWritten: 0, entriesPlanned: 0, registrationsWithMissingEntries: 0, residuals: [] });
    }
    const dry = await runLedgerBackfill(client as never, { apply: false });
    expect(dry.entriesPlanned).toBe(0);
    expect(rows.reduce((count, candidate) => count + candidate.ledgerEntries.length, 0)).toBe(1 + 2 + 4 + 1 + 1);
  });

  it("writes one small transaction per registration that needs entries, not one for the table", async () => {
    const rows = history();
    const { client, transaction } = fakeClient(rows);
    await runLedgerBackfill(client as never, { apply: true });
    expect(transaction).toHaveBeenCalledTimes(4);
  });

  it("reports a residual and writes no balancing entry when a total moved outside the ledger", async () => {
    const rows = [row("r6", "140.00", { operations: [operation("op9", "2027-02-01T10:00:00Z", 10_000, 12_000)] })];
    const { client } = fakeClient(rows);
    const report = await runLedgerBackfill(client as never, { apply: true });
    expect(report.entriesWritten).toBe(2);
    expect(report.residuals).toEqual([{ registrationId: "r6", eventId: "e1", confirmationCode: "C-r6", totalCents: 14_000, reconstructedCents: 12_000, residualCents: 2_000 }]);
    expect(rows[0]!.ledgerEntries.map((entry) => entry.amountCents)).toEqual([10_000, 2_000]);
    expect(formatBackfillReport(report)).toContain("residual $20.00");
    const again = await runLedgerBackfill(client as never, { apply: true });
    expect(again.entriesWritten).toBe(0);
    expect(again.residuals).toHaveLength(1);
  });

  it("fails closed for a registration whose amendment has no totals: reported, nothing written, others carry on", async () => {
    const broken = { ...operation("opx", "2027-02-01T10:00:00Z", 1, 2), beforeSnapshot: {}, afterSnapshot: {} };
    const rows = [row("a", "100.00", { operations: [broken] }), row("b", "20.00")];
    const { client, transaction } = fakeClient(rows);
    const report = await runLedgerBackfill(client as never, { apply: true });
    expect(report.failures).toEqual([{ registrationId: "a", message: expect.stringContaining("opx") }]);
    expect(rows[0]!.ledgerEntries).toEqual([]);
    expect(rows[1]!.ledgerEntries).toHaveLength(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("uses the original submission snapshot, so an outside change shows as a residual", async () => {
    const rows = [row("s", "185.00", { promoCodeRedemption: redemption("reds", 2_500), publicFormSubmission: { pricingSnapshot: { totalCents: 17_500, discountAmountCents: 2_500 } } })];
    const { client } = fakeClient(rows);
    const report = await runLedgerBackfill(client as never, { apply: true });
    expect(rows[0]!.ledgerEntries.map((entry) => entry.amountCents)).toEqual([20_000, -2_500]);
    expect(report.residuals).toEqual([expect.objectContaining({ registrationId: "s", residualCents: 1_000 })]);
  });

  it("is limited to one event when asked", async () => {
    const rows = [row("a", "10.00"), row("b", "20.00", { eventId: "e2" })];
    const { client } = fakeClient(rows);
    const report = await runLedgerBackfill(client as never, { apply: true, eventId: "e2" });
    expect(report.registrationsScanned).toBe(1);
    expect(rows[0]!.ledgerEntries).toEqual([]);
    expect(rows[1]!.ledgerEntries).toHaveLength(1);
  });

  it("reports a failed registration and carries on", async () => {
    const rows = [row("a", "10.00"), row("b", "20.00")];
    const { client } = fakeClient(rows);
    let calls = 0;
    const original = client.$transaction;
    client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<number>) => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return original(fn);
    }) as never;
    const report = await runLedgerBackfill(client as never, { apply: true });
    expect(report.failures).toEqual([{ registrationId: "a", message: "boom" }]);
    expect(report.entriesWritten).toBe(1);
  });
});
