import type { RateLimitOutcome } from "@/modules/rate-limit/domain";

/** When the denied limit opens again: the latest reset among the denied decisions, at least a second away. */
export function nextAllowedAt(outcome: RateLimitOutcome, now: Date) {
  const waits = outcome.decisions.filter((decision) => !decision.allowed).map((decision) => decision.resetAfterSeconds);
  return new Date(now.getTime() + Math.max(1, ...waits) * 1000);
}
