import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  DEFAULT_MESSAGE_FILE_EVENT_QUOTA_MB,
  effectiveSweepGraceHours,
} from "@/modules/communications/message-file-rules";

/**
 * The operating settings for message file storage (#845). Each is a deployment setting with a default, because the
 * numbers are a human decision (disk, backup size, how long a draft may sit): see `.env.example` and the delivery runbook.
 */

const MB = 1024 * 1024;

export function messageFileEventQuotaMb() {
  return getServerEnv().MESSAGE_FILE_EVENT_QUOTA_MB ?? DEFAULT_MESSAGE_FILE_EVENT_QUOTA_MB;
}

/** The most bytes one event may keep as message files, counting uploads in progress and files awaiting removal. */
export function messageFileEventQuotaBytes() {
  return messageFileEventQuotaMb() * MB;
}

/** The sweep's grace period in hours: the setting (default 72), never below the 24 hour floor. */
export function messageFileSweepGraceHours() {
  return effectiveSweepGraceHours(getServerEnv().MESSAGE_FILE_SWEEP_GRACE_HOURS);
}

/** True only when `MESSAGE_FILE_SWEEP_DELETE` is exactly "true". Anything else, or nothing, is a dry run. */
export function messageFileSweepDeletes() {
  return getServerEnv().MESSAGE_FILE_SWEEP_DELETE === "true";
}
