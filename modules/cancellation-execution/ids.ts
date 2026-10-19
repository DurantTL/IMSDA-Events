import { createHash } from "node:crypto";

/**
 * A stable request id for the attendee amendment of one execution, shaped like a v4 UUID, so repeating the step names the
 * same amendment rather than starting another.
 */
export function amendmentRequestId(executionId: string) {
  const bytes = createHash("sha256").update(`cancellation-execution-amendment:${executionId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
