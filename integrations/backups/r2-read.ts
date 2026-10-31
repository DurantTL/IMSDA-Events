import "server-only";

import { AwsClient } from "aws4fetch";
import { ListObjectsXmlError, parseListObjectsV2 } from "./list-objects-xml";
import type { BackupListing, BackupObject, R2ListFailure, R2ReadConfig, R2ReadConfigState } from "./types";

/**
 * The read-only look at the production backups in Cloudflare R2 (#1412).
 *
 * This module can only LIST. The method (GET) and the query (`list-type=2`) are fixed here, no caller supplies a
 * method or a URL, and there is deliberately no function that downloads, writes, copies or deletes an object. The
 * credential is an R2 token with Object Read only, so R2 would refuse anything else anyway.
 *
 * Nothing here logs. Callers get a generic failure kind, never a response body, key, bucket or host.
 */

export const R2_LIST_MAX_PAGES = 10;
export const R2_LIST_TIMEOUT_MS = 8_000;
const MAX_KEYS = "1000";
const MAX_RESPONSE_CHARS = 8_000_000;

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
// R2 bucket names: 3 to 63 characters, lowercase letters, digits and hyphens, starting and ending with a letter or digit.
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export class R2ListError extends Error {
  readonly failure: R2ListFailure;
  constructor(failure: R2ListFailure) {
    super(`R2 listing failed: ${failure}`);
    this.name = "R2ListError";
    this.failure = failure;
  }
}

type Env = Record<string, string | undefined>;

const NAMES = {
  accountId: "BACKUP_R2_READ_ACCOUNT_ID",
  accessKeyId: "BACKUP_R2_READ_ACCESS_KEY_ID",
  secretAccessKey: "BACKUP_R2_READ_SECRET_ACCESS_KEY",
  bucket: "BACKUP_R2_READ_BUCKET",
} as const;

/** Connected only when all four are set. Partly set is `misconfigured`, naming the variables (never their values). */
export function resolveR2ReadConfig(env: Env): R2ReadConfigState {
  const value = (name: string) => env[name]?.trim() ?? "";
  const required = [NAMES.accountId, NAMES.accessKeyId, NAMES.secretAccessKey, NAMES.bucket];
  const missing = required.filter((name) => !value(name));
  if (missing.length === required.length) return { state: "not_connected" };

  const invalid: string[] = [];
  if (value(NAMES.accountId) && !ACCOUNT_ID_PATTERN.test(value(NAMES.accountId))) invalid.push(NAMES.accountId);
  if (value(NAMES.bucket) && !BUCKET_PATTERN.test(value(NAMES.bucket))) invalid.push(NAMES.bucket);
  if (missing.length > 0 || invalid.length > 0) return { state: "misconfigured", missing, invalid };

  return {
    state: "connected",
    config: {
      accountId: value(NAMES.accountId).toLowerCase(),
      accessKeyId: value(NAMES.accessKeyId),
      secretAccessKey: value(NAMES.secretAccessKey),
      bucket: value(NAMES.bucket),
      prefix: value("BACKUP_R2_READ_PREFIX"),
    },
  };
}

export type ListBackupObjectsOptions = {
  /** Tests inject a mock; production uses the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
};

function listUrl(config: R2ReadConfig, continuationToken: string | null): string {
  const params = new URLSearchParams();
  params.set("list-type", "2");
  if (config.prefix) params.set("prefix", config.prefix);
  params.set("max-keys", MAX_KEYS);
  if (continuationToken) params.set("continuation-token", continuationToken);
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}?${params.toString()}`;
}

/** Lists the objects under the configured prefix. Throws `R2ListError` with a generic failure kind. */
export async function listBackupObjects(
  config: R2ReadConfig,
  options: ListBackupObjectsOptions = {},
): Promise<BackupListing> {
  if (!ACCOUNT_ID_PATTERN.test(config.accountId) || !BUCKET_PATTERN.test(config.bucket)) {
    throw new R2ListError("bad_response");
  }
  const send = options.fetch ?? fetch;
  const maxPages = Math.min(options.maxPages ?? R2_LIST_MAX_PAGES, R2_LIST_MAX_PAGES);
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? R2_LIST_TIMEOUT_MS);
  const objects: BackupObject[] = [];
  let token: string | null = null;
  let partial = false;
  try {
    for (let page = 1; ; page += 1) {
      const response = await fetchPage(client, send, listUrl(config, token), controller.signal);
      const parsed = await readPage(response);
      objects.push(...parsed.objects);
      if (!parsed.truncated) break;
      if (!parsed.nextToken || page >= maxPages) {
        partial = true;
        break;
      }
      token = parsed.nextToken;
    }
  } catch (error) {
    if (error instanceof R2ListError) throw error;
    throw new R2ListError(controller.signal.aborted ? "timeout" : "unreachable");
  } finally {
    clearTimeout(timer);
  }
  return { objects, partial };
}

async function fetchPage(client: AwsClient, send: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  const request = await client.sign(url, { method: "GET", signal });
  const response = await send(request);
  if (response.status === 401 || response.status === 403) throw new R2ListError("refused");
  if (!response.ok) throw new R2ListError("bad_response");
  return response;
}

async function readPage(response: Response) {
  // A failure while the body streams (an abort included) propagates to the caller, which tells timeout from unreachable.
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new R2ListError("bad_response");
  try {
    return parseListObjectsV2(text);
  } catch (error) {
    if (error instanceof ListObjectsXmlError) throw new R2ListError("bad_response");
    throw error;
  }
}
