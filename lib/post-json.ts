import { submitJson, submitJsonTimeoutMs, type SubmitJsonOptions, type SubmitJsonResult } from "@/lib/submit-json";

/** Longer than the server's own transaction limit, so its readable error wins when there is one. */
export const postJsonTimeoutMs = submitJsonTimeoutMs;

export type PostJsonResult = SubmitJsonResult;

/**
 * POSTs JSON and always settles (#617): a request that outlasts the timeout, or an answer that is
 * not JSON, becomes a readable `message` instead of an endless spinner. `fallbackMessage` starts
 * every synthesized message. A restart or lost connection returns `unavailable: true` (#1263); see
 * `lib/submit-json.ts`, which this wraps, for PUT/PATCH/DELETE and idempotent retries.
 */
export async function postJson(
  url: string,
  payload: unknown,
  fallbackMessage: string,
  timeoutMs = postJsonTimeoutMs,
  options: Omit<SubmitJsonOptions, "fallbackMessage" | "timeoutMs"> & { wait?: (ms: number) => Promise<void> } = {},
): Promise<PostJsonResult> {
  return submitJson(url, payload, { ...options, fallbackMessage, timeoutMs });
}
