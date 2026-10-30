/** The shared words of a read-only connection test (#1357), free of any provider code. */
export type ReachabilityOutcome = "reachable" | "refused" | "unavailable";
export type ReachabilityResult = { outcome: ReachabilityOutcome; ms: number } | { outcome: "not-configured" };

/** Each test is time-boxed: a provider that does not answer in this long is "unavailable". */
export const REACHABILITY_TIMEOUT_MS = 5_000;

/** A stored test result older than this reads "Test again". */
export const REACHABILITY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
