import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  SERVER_AUTODEPLOY_JOB,
  SERVER_DOCKER_CLEANUP_JOB,
  SERVER_LOAD_REHEARSAL_JOB,
  SERVER_PREDEPLOY_BACKUP_JOB,
  SERVER_RESTORE_DRILL_JOB,
  SERVER_RUNTIME_GUARD_JOB,
} from "@/modules/operations/sweep-heartbeat";

/**
 * The host's own jobs (auto-deploy, Docker cleanup, runtime guard) report one heartbeat per run (#1382). Pure: the
 * authorizer and the strict payload schema. The write is `recordJobRun`. Words and small counts only, never an address,
 * host name, path, commit or key.
 */

export const HOST_JOB_HEARTBEAT_MAX_BODY_BYTES = 2048;
export const HOST_JOB_HEARTBEAT_MIN_TOKEN_LENGTH = 32;

/** Compares the bearer token in constant time. False when no usable token is configured: never open by omission. */
export function isAuthorizedHostJobRequest(request: Request, configured: string | undefined): boolean {
  if (!configured || configured.length < HOST_JOB_HEARTBEAT_MIN_TOKEN_LENGTH) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) return false;

  const expectedBytes = Buffer.from(configured, "utf8");
  const presentedBytes = Buffer.from(presented, "utf8");
  if (expectedBytes.length !== presentedBytes.length) {
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(expectedBytes, presentedBytes);
}

export const AUTODEPLOY_SUCCESS_RESULTS = ["up-to-date", "outside-window", "image-pending", "deployed"] as const;
export const AUTODEPLOY_FAILURE_RESULTS = [
  "deploy-failed",
  "fetch-failed",
  "failed-commit-held",
  "no-owner",
  "fast-forward-failed",
] as const;

const percent = z.number().int().min(0).max(100);

/** A short commit id (7 to 12 hex characters), the only thing about a version a heartbeat may carry. */
const shortVersion = z.string().regex(/^[0-9a-f]{7,12}$/);
const smallCount = z.number().int().min(0).max(1000000);

const autodeploySummary = z
  .object({ result: z.enum([...AUTODEPLOY_SUCCESS_RESULTS, ...AUTODEPLOY_FAILURE_RESULTS]), version: shortVersion.optional() })
  .strict();
/** The database copy before a deploy (#1790): copied, or skipped on purpose (still a run that worked), or failed. */
export const PREDEPLOY_SUCCESS_RESULTS = ["copied", "skipped"] as const;
const predeploySummary = z.object({ result: z.enum(["copied", "skipped", "failed"]), version: shortVersion.optional() }).strict();
/** A restore drill (#1792) and a load rehearsal (#1791): pass or fail, with minutes and counts only. */
const restoreDrillSummary = z
  .object({ result: z.enum(["passed", "failed"]), minutes: smallCount.optional(), checks: smallCount.optional(), failed: smallCount.optional() })
  .strict();
const loadRehearsalSummary = z
  .object({ result: z.enum(["passed", "failed"]), minutes: smallCount.optional(), requests: smallCount.optional(), failed: smallCount.optional() })
  .strict();
const cleanupSummary = z
  .object({
    result: z.enum(["cleaned", "skipped-lock-busy"]),
    diskUsedBeforePct: percent.optional(),
    diskUsedAfterPct: percent.optional(),
    imagesRemoved: z.number().int().min(0).max(100000).optional(),
  })
  .strict();
const guardSummary = z.object({ result: z.enum(["ok", "failed"]) }).strict();

const outcome = z.enum(["SUCCEEDED", "FAILED"]);

export const hostJobHeartbeatSchema = z
  .discriminatedUnion("job", [
    z.object({ job: z.literal(SERVER_AUTODEPLOY_JOB), outcome, summary: autodeploySummary }).strict(),
    z.object({ job: z.literal(SERVER_DOCKER_CLEANUP_JOB), outcome, summary: cleanupSummary }).strict(),
    z.object({ job: z.literal(SERVER_RUNTIME_GUARD_JOB), outcome, summary: guardSummary }).strict(),
    z.object({ job: z.literal(SERVER_PREDEPLOY_BACKUP_JOB), outcome, summary: predeploySummary }).strict(),
    z.object({ job: z.literal(SERVER_RESTORE_DRILL_JOB), outcome, summary: restoreDrillSummary }).strict(),
    z.object({ job: z.literal(SERVER_LOAD_REHEARSAL_JOB), outcome, summary: loadRehearsalSummary }).strict(),
  ])
  .refine((value) => {
    // A cleanup that skipped because a deploy held the lock is a normal, successful run.
    let succeeds: boolean;
    switch (value.job) {
      case SERVER_AUTODEPLOY_JOB:
        succeeds = (AUTODEPLOY_SUCCESS_RESULTS as readonly string[]).includes(value.summary.result);
        break;
      case SERVER_DOCKER_CLEANUP_JOB:
        succeeds = true;
        break;
      case SERVER_RUNTIME_GUARD_JOB:
        succeeds = value.summary.result === "ok";
        break;
      case SERVER_PREDEPLOY_BACKUP_JOB:
        succeeds = (PREDEPLOY_SUCCESS_RESULTS as readonly string[]).includes(value.summary.result);
        break;
      default:
        succeeds = value.summary.result === "passed";
    }
    return succeeds === (value.outcome === "SUCCEEDED");
  });

export type HostJobHeartbeat = z.infer<typeof hostJobHeartbeatSchema>;

/** Parses a raw body. Null for anything that is not exactly an allowed heartbeat; never returns or echoes input. */
export function parseHostJobHeartbeat(raw: string): HostJobHeartbeat | null {
  if (Buffer.byteLength(raw, "utf8") > HOST_JOB_HEARTBEAT_MAX_BODY_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = hostJobHeartbeatSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
