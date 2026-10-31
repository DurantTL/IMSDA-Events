import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { isStuckFailure } from "@/modules/cancellation-execution/domain";
import { reportChurchShareDrift } from "@/modules/lodging/church-share-drift";
import { PAY_ON_SQUARE_LINK_SWEEP_JOB } from "@/modules/operations/sweep-heartbeat";
import { payOnSquareLinkSweepFields } from "./job-signals";
import { runRefundSelfTest } from "./refund-self-test";
import type { SignalState } from "./model";
import type { defineProvider, Read, ReportContext, SignalProvider } from "./providers";

/**
 * The "Refunds and payment follow-up" checks (#1374). Read-only: counts and times only, never a name, a registration,
 * an address or an amount for one person. Built from `providers.ts`'s helpers, passed in so this file never imports
 * that one at run time (it appends this list, so importing it back would be a cycle).
 */

/** A refund the processor has not answered for this long is stuck. */
export const REFUND_PENDING_STUCK_AFTER_MS = 60 * 60 * 1000;
/** A failed refund stays on the report this long. */
export const REFUND_FAILED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type EventReads<T> = { readAt: Date; events: Array<{ id: string; name: string }>; results: Array<{ id: string; name: string; value: T }>; failed: number };

export type MoneyKit = {
  defineProvider: typeof defineProvider;
  perEvent: <T>(ctx: ReportContext, key: string, run: (eventId: string) => Promise<T>) => Promise<Read<EventReads<T>>>;
  tried: (read: Read<unknown>, reason?: string) => { checkedAt: string; whenLabel: string; state: "unavailable"; resultText: string };
  iso: (date: Date) => string;
  m: (key: string, name: string, description: string, fixHref?: string | null, fixLabel?: string | null) => Parameters<typeof defineProvider>[1][number];
  jobRow: (ctx: Parameters<Parameters<typeof defineProvider>[2]>[0], job: string, key: string, fields: typeof payOnSquareLinkSweepFields) => Promise<Awaited<ReturnType<Parameters<typeof defineProvider>[2]>>[number]>;
  couldNotReadNote: (failed: number) => string;
  eventHref: (path: string, eventId: string, extra?: string) => string;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const RANK: Record<SignalState, number> = { attention: 0, unavailable: 1, watch: 2, ok: 3, info: 3 };
const worse = (a: SignalState, b: SignalState): SignalState => (RANK[a] <= RANK[b] ? a : b);

export function buildMoneyProviders(kit: MoneyKit): SignalProvider[] {
  const { defineProvider: define, perEvent, tried, iso, m, jobRow, couldNotReadNote, eventHref } = kit;
  return [
    define("money", [
      m("cancellations-stuck", "Cancellations stuck", "Cancellations whose refund is still with Square, or failed in a way that needs a person.", "/finance/cancellation-requests", "Open cancellation requests"),
      m("refunds-stuck", "Refunds", "Refunds waiting over an hour for Square's answer, and refunds that failed in the last 7 days.", "/finance", "Open finance"),
      m("duplicate-charges", "Duplicate charges open", "Square charges taken twice for one payment that no one has resolved yet.", "/finance/square-payments", "Open Square payments"),
      m("pay-on-square-sweep", "Pay on Square link sweep", "When the sweep that withdraws old payment links last ran, and withdrawn links Square has not yet deleted.", "/more/health", "Open operational health"),
      m("church-share-drift", "Church-share lodging billing drift", "Church-sponsored registrations whose stored lodging share differs from what it recomputes to now.", "/finance", "Open finance"),
      m("refund-self-test", "Refund calculator self-test", "The refund calculator and refund split give the known answers on a fixed example. No registration is used.", null, "Fixed on the server"),
    ], async (ctx) => {
      const rows: Awaited<ReturnType<Parameters<typeof defineProvider>[2]>> = [];

      // 1. Cancellations stuck.
      const executions = await ctx.once("money:cancellations", async () => getPrisma().cancellationExecution.groupBy({
        by: ["eventId", "status", "lastFailureCode"],
        where: { status: { in: ["PROCESSOR_PENDING", "FAILED"] } },
        _count: { _all: true },
        orderBy: { eventId: "asc" },
      }));
      if (!executions.ok) rows.push({ key: "cancellations-stuck", ...tried(executions) });
      else {
        const pending = executions.value.filter((group) => group.status === "PROCESSOR_PENDING");
        const failed = executions.value.filter((group) => group.status === "FAILED" && isStuckFailure(group.lastFailureCode));
        const sum = (groups: typeof pending) => groups.reduce((total, group) => total + group._count._all, 0);
        const pendingCount = sum(pending);
        const failedCount = sum(failed);
        const common = { key: "cancellations-stuck", checkedAt: iso(executions.readAt), whenLabel: "Checked" };
        if (pendingCount + failedCount === 0) rows.push({ ...common, state: "ok", resultText: "No cancellation is waiting on Square or stuck after a failed refund." });
        else {
          const first = [...pending, ...failed].map((group) => group.eventId).sort()[0];
          rows.push({
            ...common,
            state: failedCount > 0 ? "attention" : "watch",
            resultText: `${plural(pendingCount, "cancellation", "cancellations")} waiting on Square and ${plural(failedCount, "cancellation", "cancellations")} stuck after a failed refund.`,
            fixHref: eventHref("/finance/cancellation-requests", first),
          });
        }
      }

      // 2. Refunds.
      const refunds = await ctx.once("money:refunds", async () => {
        const prisma = getPrisma();
        const [pending, failed] = await Promise.all([
          prisma.refund.count({ where: { status: "PENDING", createdAt: { lt: new Date(ctx.now.getTime() - REFUND_PENDING_STUCK_AFTER_MS) } } }),
          // A refund has no failure time of its own; the row is last changed when it is marked failed.
          prisma.refund.count({ where: { status: "FAILED", updatedAt: { gte: new Date(ctx.now.getTime() - REFUND_FAILED_LOOKBACK_MS) } } }),
        ]);
        return { pending, failed };
      });
      if (!refunds.ok) rows.push({ key: "refunds-stuck", ...tried(refunds) });
      else {
        const { pending, failed } = refunds.value;
        const common = { key: "refunds-stuck", checkedAt: iso(refunds.readAt), whenLabel: "Checked" };
        rows.push(pending + failed === 0
          ? { ...common, state: "ok", resultText: "No refund has waited over an hour, and none failed in the last 7 days." }
          : { ...common, state: failed > 0 ? "attention" : "watch", resultText: `${plural(pending, "refund", "refunds")} waiting over an hour and ${plural(failed, "refund", "refunds")} failed in the last 7 days.` });
      }

      // 3. Duplicate charges.
      const duplicates = await ctx.once("money:duplicate-charges", async () => getPrisma().squareDuplicateCharge.count({ where: { status: "OPEN" } }));
      if (!duplicates.ok) rows.push({ key: "duplicate-charges", ...tried(duplicates) });
      else {
        const common = { key: "duplicate-charges", checkedAt: iso(duplicates.readAt), whenLabel: "Checked" };
        rows.push(duplicates.value === 0
          ? { ...common, state: "ok", resultText: "No duplicate Square charge is waiting to be resolved." }
          : { ...common, state: "attention", resultText: `${plural(duplicates.value, "duplicate charge", "duplicate charges")} still open.` });
      }

      // 4. Pay on Square link sweep: its last run, plus withdrawn links Square has not confirmed deleted.
      const sweep = await jobRow(ctx, PAY_ON_SQUARE_LINK_SWEEP_JOB, "pay-on-square-sweep", payOnSquareLinkSweepFields);
      const stuckLinks = await ctx.once("money:hosted-delete-errors", async () => getPrisma().squareHostedCheckout.count({ where: { providerDeleteError: { not: null }, providerDeletedAt: null } }));
      if (!stuckLinks.ok) rows.push({ key: "pay-on-square-sweep", ...tried(stuckLinks, "The count of links Square has not deleted could not be read. It is not shown as healthy.") });
      else {
        const count = stuckLinks.value;
        const note = count === 0 ? "No withdrawn link is waiting on Square." : `${plural(count, "withdrawn link", "withdrawn links")} Square has not deleted after an error.`;
        rows.push({
          ...sweep,
          state: count > 0 ? worse(sweep.state, "watch") : sweep.state,
          resultText: `${sweep.resultText} ${note}`,
        });
      }

      // 5. Church-share lodging billing drift, per event in the report's 30-day window.
      const drift = await perEvent(ctx, "church-share-drift", (eventId) => reportChurchShareDrift(getPrisma(), { eventId }));
      if (!drift.ok) rows.push({ key: "church-share-drift", ...tried(drift) });
      else {
        const { results, failed, readAt } = drift.value;
        const affected = results.filter((result) => result.value.rows.length > 0);
        const drifting = affected.reduce((total, result) => total + result.value.rows.length, 0);
        const scanned = results.reduce((total, result) => total + result.value.scanned, 0);
        if (drifting > 0) {
          rows.push({
            key: "church-share-drift", state: "watch", checkedAt: iso(readAt), whenLabel: "Checked",
            resultText: `${plural(drifting, "registration", "registrations")} at ${plural(affected.length, "event", "events")} differ from the recompute.${couldNotReadNote(failed)}`,
            fixHref: eventHref("/finance", affected[0].id),
          });
        } else if (failed > 0) {
          rows.push({ key: "church-share-drift", state: "unavailable", checkedAt: iso(readAt), whenLabel: "Tried", resultText: `None differ in the events that were read.${couldNotReadNote(failed)} It is not shown as OK.` });
        } else {
          rows.push({ key: "church-share-drift", state: "ok", checkedAt: iso(readAt), whenLabel: "Checked", resultText: `0 of ${plural(scanned, "church-sponsored registration", "church-sponsored registrations")} differ.` });
        }
      }

      // 6. Refund calculator self-test: pure, no database. A throw leaves the row to defineProvider as unavailable.
      try {
        const selfTest = runRefundSelfTest();
        rows.push(selfTest.differing.length === 0
          ? { key: "refund-self-test", state: "ok", resultText: `All ${selfTest.total} fixed examples give the known answer.` }
          : { key: "refund-self-test", state: "attention", resultText: `${selfTest.differing.length} of ${selfTest.total} fixed examples differ from the known answer. Do not carry out refunds until a developer checks.` });
      } catch (error) {
        logError("The refund calculator self-test could not run", error);
        rows.push({ key: "refund-self-test", ...tried({ ok: false, readAt: new Date() }, "The self-test could not run. It is not shown as passing.") });
      }
      return rows;
    }),
  ];
}
