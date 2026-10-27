import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ledgerEntryKey,
  planRegistrationBackfill,
  type BackfillPlan,
  type LedgerEntryDraft,
} from "@/modules/ledger/domain";
import { appendLedgerEntriesIdempotent } from "@/modules/ledger/entries";
import { moneyToCents } from "@/modules/payments/square-domain";

/**
 * Ledger backfill (#117). Run by hand through `npm run ledger:backfill`, never from the seed, a migration, postinstall
 * or app start. Dry-run unless `apply` is true. Idempotent: it shares the live writers' (sourceType, sourceId, kind) key
 * and skips what exists. No balancing "plug" entry is ever written: when the reconstruction differs from today's total
 * (because a writer outside this slice changed it), the residual is reported and left for the health view.
 */
export type BackfillOptions = {
  apply: boolean;
  eventId?: string;
  /** Registrations read per page. Each registration is written in its own small transaction. */
  batchSize?: number;
};

export type BackfillResidual = {
  registrationId: string;
  eventId: string;
  confirmationCode: string;
  totalCents: number;
  reconstructedCents: number;
  residualCents: number;
};

export type BackfillReport = {
  apply: boolean;
  registrationsScanned: number;
  registrationsWithMissingEntries: number;
  entriesPlanned: number;
  entriesWritten: number;
  entriesByKind: Record<string, number>;
  residuals: BackfillResidual[];
  warnings: string[];
  failures: Array<{ registrationId: string; message: string }>;
};

type Client = Pick<PrismaClient, "registration" | "$transaction">;

const include = {
  promoCodeRedemption: true,
  publicFormSubmission: { select: { pricingSnapshot: true } },
  operations: { where: { type: "AMENDMENT" as const }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  ledgerEntries: { select: { sourceType: true, sourceId: true, kind: true, amountCents: true } },
} satisfies Prisma.RegistrationInclude;

type Row = Prisma.RegistrationGetPayload<{ include: typeof include }>;

function toPlanInput(row: Row) {
  return {
    id: row.id,
    eventId: row.eventId,
    totalCents: moneyToCents(row.totalAmount),
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    submissionSnapshot: row.publicFormSubmission?.pricingSnapshot ?? null,
    redemption: row.promoCodeRedemption
      ? {
          id: row.promoCodeRedemption.id,
          createdAt: row.promoCodeRedemption.createdAt,
          codeSnapshot: row.promoCodeRedemption.codeSnapshot,
          discountTypeSnapshot: row.promoCodeRedemption.discountTypeSnapshot,
          discountValueSnapshot: row.promoCodeRedemption.discountValueSnapshot,
          minimumSubtotalCentsSnapshot: row.promoCodeRedemption.minimumSubtotalCentsSnapshot,
          maximumDiscountCentsSnapshot: row.promoCodeRedemption.maximumDiscountCentsSnapshot,
          eligibleSubtotalCents: row.promoCodeRedemption.eligibleSubtotalCents,
          discountAmountCents: row.promoCodeRedemption.discountAmountCents,
          pricingDate: row.promoCodeRedemption.pricingDate,
        }
      : null,
    amendments: row.operations.map((operation) => ({
      id: operation.id,
      createdAt: operation.createdAt,
      actorUserId: operation.actorUserId,
      actorAttendeeAccountId: operation.actorAttendeeAccountId,
      actorPersonId: operation.actorPersonId,
      actorNameSnapshot: operation.actorNameSnapshot,
      beforeSnapshot: operation.beforeSnapshot,
      afterSnapshot: operation.afterSnapshot,
    })),
    existingKeys: new Set(row.ledgerEntries.map(ledgerEntryKey)),
    existingSumCents: row.ledgerEntries.reduce((sum, entry) => sum + entry.amountCents, 0),
  };
}

export async function runLedgerBackfill(client: Client, options: BackfillOptions): Promise<BackfillReport> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 200, 1000));
  const report: BackfillReport = {
    apply: options.apply,
    registrationsScanned: 0,
    registrationsWithMissingEntries: 0,
    entriesPlanned: 0,
    entriesWritten: 0,
    entriesByKind: {},
    residuals: [],
    warnings: [],
    failures: [],
  };
  let cursor: string | undefined;
  for (;;) {
    const rows: Row[] = await client.registration.findMany({
      where: options.eventId ? { eventId: options.eventId } : {},
      include,
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      report.registrationsScanned += 1;
      let plan: BackfillPlan;
      try {
        plan = planRegistrationBackfill(toPlanInput(row));
      } catch (error) {
        report.failures.push({ registrationId: row.id, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (plan.failure) {
        report.failures.push({ registrationId: row.id, message: plan.failure });
        continue;
      }
      for (const warning of plan.warnings) report.warnings.push(`${row.confirmationCode}: ${warning}`);
      if (plan.entries.length > 0) {
        report.registrationsWithMissingEntries += 1;
        report.entriesPlanned += plan.entries.length;
        for (const entry of plan.entries) report.entriesByKind[entry.kind] = (report.entriesByKind[entry.kind] ?? 0) + 1;
        if (options.apply) {
          try {
            report.entriesWritten += await writeRegistration(client, plan.entries);
          } catch (error) {
            report.failures.push({ registrationId: row.id, message: error instanceof Error ? error.message : String(error) });
            continue;
          }
        }
      }
      if (plan.residualCents !== 0) {
        report.residuals.push({
          registrationId: row.id,
          eventId: row.eventId,
          confirmationCode: row.confirmationCode,
          totalCents: moneyToCents(row.totalAmount),
          reconstructedCents: plan.resultingTotalCents,
          residualCents: plan.residualCents,
        });
      }
    }
    if (rows.length < batchSize) break;
  }
  return report;
}

function writeRegistration(client: Client, entries: readonly LedgerEntryDraft[]) {
  // One registration per transaction: a production-sized table is never one giant transaction.
  return client.$transaction((tx) => appendLedgerEntriesIdempotent(tx, entries), { timeout: 30_000 });
}

export function formatBackfillReport(report: BackfillReport) {
  const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const lines = [
    report.apply ? "Ledger backfill: APPLIED" : "Ledger backfill: DRY RUN (nothing written; pass --apply to write)",
    `Registrations scanned: ${report.registrationsScanned}`,
    `Registrations missing entries: ${report.registrationsWithMissingEntries}`,
    `Entries ${report.apply ? "written" : "that would be written"}: ${report.apply ? report.entriesWritten : report.entriesPlanned}` +
      (Object.keys(report.entriesByKind).length > 0
        ? ` (${Object.entries(report.entriesByKind).map(([kind, count]) => `${count} ${kind}`).join(", ")})`
        : ""),
    `Residuals (ledger does not equal today's total): ${report.residuals.length}`,
  ];
  for (const residual of report.residuals.slice(0, 50)) {
    lines.push(
      `  ${residual.confirmationCode} (${residual.registrationId}): total ${money(residual.totalCents)}, ledger ${money(residual.reconstructedCents)}, residual ${money(residual.residualCents)}`,
    );
  }
  if (report.residuals.length > 50) lines.push(`  ... and ${report.residuals.length - 50} more`);
  if (report.residuals.length > 0) {
    lines.push("Residuals are left alone on purpose: a writer outside this slice changed the total. The health view lists them.");
  }
  for (const warning of report.warnings.slice(0, 20)) lines.push(`Warning: ${warning}`);
  for (const failure of report.failures) lines.push(`FAILED ${failure.registrationId}: ${failure.message}`);
  return lines.join("\n");
}
