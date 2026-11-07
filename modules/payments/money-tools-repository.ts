import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { listPolicyVersions } from "@/modules/cancellation-policy/repository";
import { reconcileRegistrationLedger } from "@/modules/ledger/reconciliation";
import { countOpenChurchSponsorFlags } from "@/modules/promo-codes/church-sponsor-lodging";
import { getFundView } from "@/modules/scholarship-funds/repository";
import { neededMoneyMetrics, type MoneyMetricKey, type MoneyMetricValues, type MoneyToolsViewer } from "@/modules/payments/money-tools-model";

/**
 * The numbers behind the More money tools cards (#1575), for one event. Only the metrics of a card this viewer sees are read
 * (`neededMoneyMetrics`), each read stands alone, and a read that fails is logged and becomes `null`, which the card shows
 * as "Unavailable". The caller has already checked MANAGE_FINANCE; each metric reuses the count the card's own page reads.
 * Nothing here writes.
 */
type Context = { eventId: string; now: Date; shared: Map<string, Promise<unknown>> };

/** One read shared by the metrics that come from it (a failure of it makes each of them unavailable). */
function shared<T>(context: Context, key: string, read: () => Promise<T>): Promise<T> {
  let promise = context.shared.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = read();
    context.shared.set(key, promise);
  }
  return promise;
}

const policy = (context: Context) => shared(context, "policy", () => listPolicyVersions(context.eventId, context.now));

const readers: Record<MoneyMetricKey, (context: Context) => Promise<number>> = {
  // The Payments page's notice and the Owed by churches page read the same open flags.
  churchFlags: ({ eventId }) => countOpenChurchSponsorFlags(eventId),
  // The Ledger check page's own list of registrations that differ.
  ledgerDifferences: async ({ eventId }) => (await reconcileRegistrationLedger(getPrisma(), { eventId })).failing.length,
  policyVersions: async (context) => (await policy(context)).versions.length,
  // A version that is saved but unreadable, or starts later, is not "in effect".
  policyInEffect: async (context) => ((await policy(context)).inEffectVersionId ? 1 : 0),
  // The Invoices report's own draft count.
  draftInvoices: ({ eventId }) => getPrisma().invoiceVersion.count({ where: { eventId, status: "DRAFT" } }),
  // Exact server cents, as the Scholarship fund page shows its balance.
  scholarshipBalanceCents: async ({ eventId }) => (await getFundView(eventId)).summary.balanceCents,
};

/** The values for one event and viewer. A metric that failed is `null`; a metric no shown card needs is not read. */
export async function loadMoneyToolMetrics(viewer: MoneyToolsViewer, eventId: string, now = new Date()): Promise<MoneyMetricValues> {
  const context: Context = { eventId, now, shared: new Map() };
  const entries = await Promise.all(
    neededMoneyMetrics(viewer).map(async (key): Promise<[MoneyMetricKey, number | null]> => {
      try {
        const value = await readers[key](context);
        return [key, Number.isFinite(value) ? value : null];
      } catch (error) {
        logError(`More money tools number could not load: ${key}`, error);
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}
