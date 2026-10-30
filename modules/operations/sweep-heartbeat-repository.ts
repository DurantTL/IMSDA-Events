import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  OUTBOX_SWEEP_JOB,
  assessSweepHeartbeat,
} from "@/modules/operations/sweep-heartbeat";

export async function recordSweepHeartbeat(
  outcome: "SUCCEEDED" | "FAILED",
  now = new Date(),
) {
  const field = outcome === "SUCCEEDED" ? "lastSucceededAt" : "lastFailedAt";
  await getPrisma().systemJobHeartbeat.upsert({
    where: { job: OUTBOX_SWEEP_JOB },
    create: { job: OUTBOX_SWEEP_JOB, [field]: now },
    update: { [field]: now },
  });
}

export async function getSweepHeartbeat(now = new Date()) {
  const record = await getPrisma().systemJobHeartbeat.findUnique({
    where: { job: OUTBOX_SWEEP_JOB },
    select: { lastSucceededAt: true, lastFailedAt: true },
  });
  return assessSweepHeartbeat(record, now);
}

/**
 * Generic job runs (#1357): the same `SystemJobHeartbeat` row the outbox sweep uses, keyed by job, with the latest
 * run's counts. `summary` is counts and fixed words only (never a file name, path, address or key). A failed run keeps
 * the last good summary, so the report can still say what the last success found.
 */
export type JobSummary = Record<string, string | number | boolean | null>;

export async function recordJobRun(
  job: string,
  outcome: "SUCCEEDED" | "FAILED",
  summary?: JobSummary,
  now = new Date(),
) {
  const field = outcome === "SUCCEEDED" ? "lastSucceededAt" : "lastFailedAt";
  const withSummary = summary ? { lastSummary: summary } : {};
  await getPrisma().systemJobHeartbeat.upsert({
    where: { job },
    create: { job, [field]: now, ...withSummary },
    update: { [field]: now, ...withSummary },
  });
}

export type JobRun = ReturnType<typeof assessSweepHeartbeat> & { summary: JobSummary | null };

/** The job's latest run, judged like the sweep. `staleAfterMs` is how long without a success counts as stale. */
export async function getJobRun(job: string, now = new Date(), staleAfterMs?: number): Promise<JobRun> {
  const record = await getPrisma().systemJobHeartbeat.findUnique({
    where: { job },
    select: { lastSucceededAt: true, lastFailedAt: true, lastSummary: true },
  });
  const summary = record?.lastSummary;
  return {
    ...assessSweepHeartbeat(record, now, staleAfterMs),
    summary: summary && typeof summary === "object" && !Array.isArray(summary) ? (summary as JobSummary) : null,
  };
}
