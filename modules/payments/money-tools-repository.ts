import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { hasApprovedReconciliation } from "@/modules/attendance-reconciliation/repository";
import { getBillingResponsibilityView } from "@/modules/billing-responsibility/repository";
import { countOpenInvoiceDrafts } from "@/modules/invoices/repository";
import { listPolicyVersions } from "@/modules/cancellation-policy/repository";
import { reconcileRegistrationLedger } from "@/modules/ledger/reconciliation";
import { countOpenChurchSponsorFlags } from "@/modules/promo-codes/church-sponsor-lodging";
import { listUnmatchedSquarePayments } from "@/modules/payments/square-match-repository";
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

const billing = (context: Context) => shared(context, "billing", () => getBillingResponsibilityView(context.eventId));

const readers: Record<MoneyMetricKey, (context: Context) => Promise<number>> = {
  // The Payments page's notice and the Owed by churches page read the same open flags.
  churchFlags: ({ eventId }) => countOpenChurchSponsorFlags(eventId),
  // The Ledger check page's own list of registrations that differ.
  ledgerDifferences: async ({ eventId }) => (await reconcileRegistrationLedger(getPrisma(), { eventId })).failing.length,
  policyVersions: async (context) => (await policy(context)).versions.length,
  // A version that is saved but unreadable, or starts later, is not "in effect".
  policyInEffect: async (context) => ((await policy(context)).inEffectVersionId ? 1 : 0),
  // The Invoices page's own draft count (church promo-code invoices are left out, as there).
  draftInvoices: ({ eventId }) => countOpenInvoiceDrafts(eventId),
  // The Billing responsibility page's own counts, from one read.
  billingUnrecorded: async (context) => (await billing(context)).unrecordedCount,
  billingOutdated: async (context) => (await billing(context)).outdatedCount,
  billingUnresolved: async (context) => (await billing(context)).summary.unresolvedCount,
  billingNeedsContact: async (context) => (await billing(context)).summary.needsContactCount,
  // The pages' own test for "This event is not billed to organizations" (billing mode is not deferred organization invoicing).
  billedToOrganizations: async (context) => ((await billing(context)).isDeferred ? 1 : 0),
  attendanceApproved: async ({ eventId }) => ((await hasApprovedReconciliation(eventId)) ? 1 : 0),
  // The Unmatched Square payments page's own list (default window). Not configured or unreachable throws, so the card says "Unavailable", never "None waiting".
  unmatchedSquare: async () => {
    const { findings, unreachableSquare } = await listUnmatchedSquarePayments();
    if (unreachableSquare) throw new Error("Square could not be reached");
    return findings.length;
  },
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
