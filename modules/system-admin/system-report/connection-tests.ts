import "server-only";

import { checkEmailReachable } from "@/integrations/email/reachability";
import { logError } from "@/lib/logger";
import { checkSquareReachable } from "@/modules/payments/square-reachability";
import type { ReachabilityResult } from "@/modules/operations/reachability";
import { EMAIL_REACHABILITY_JOB, SQUARE_REACHABILITY_JOB } from "@/modules/operations/sweep-heartbeat";
import { recordJobRun } from "@/modules/operations/sweep-heartbeat-repository";

/**
 * The System report's "Test connections" action (#1357): runs the two read-only reachability tests, side by side, and
 * stores each result on its `SystemJobHeartbeat` row as { outcome, ms }. A service that is not set up is not tested and
 * stores nothing, so no network call is made for it. Recording a result never fails the action.
 */
export type ConnectionTestDeps = {
  email?: () => Promise<ReachabilityResult>;
  square?: () => Promise<ReachabilityResult>;
  record?: typeof recordJobRun;
};

async function runOne(job: string, test: () => Promise<ReachabilityResult>, record: typeof recordJobRun) {
  const result = await test().catch((): ReachabilityResult => ({ outcome: "unavailable", ms: 0 }));
  if (result.outcome === "not-configured") return result.outcome;
  await record(job, result.outcome === "reachable" ? "SUCCEEDED" : "FAILED", { outcome: result.outcome, ms: result.ms }).catch((error) => {
    logError("Could not record a connection test result", error);
  });
  return result.outcome;
}

export async function runConnectionTests(deps: ConnectionTestDeps = {}) {
  const record = deps.record ?? recordJobRun;
  const [email, square] = await Promise.all([
    runOne(EMAIL_REACHABILITY_JOB, deps.email ?? checkEmailReachable, record),
    runOne(SQUARE_REACHABILITY_JOB, deps.square ?? checkSquareReachable, record),
  ]);
  return { email, square };
}
