import "server-only";

import { randomUUID } from "node:crypto";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { getSquareConfiguration } from "@/modules/payments/square-config";
import type { SquareRuntimeConfiguration } from "@/modules/payments/square-config";
import { createSquarePaymentLink, deleteSquarePaymentLink, type SquarePaymentLinkResult } from "@/modules/payments/square-payment-link-adapter";
import { record, SquareAdapterError, type Fetcher } from "@/modules/payments/square-http";
import { checkSystemSquareTestRateLimit } from "@/modules/rate-limit/service";
import { newSystemTestRef } from "@/modules/communications/system-test-email";
import { nextAllowedAt } from "@/modules/system-admin/system-report/tester-limits";

/**
 * The System report's Square tester (#1383). It checks the account, the location, the notice subscription and Square's
 * own test notice, and optionally makes a $1 payment link and deletes it again. NOTHING HERE CAN MOVE MONEY.
 *
 * That is enforced in one place. Every request this tester makes, including the two the payment-link adapter makes for
 * it, goes through `guardedFetch`, which refuses anything not in `SQUARE_TESTER_ALLOWED_REQUESTS`: no payment, charge,
 * refund, capture or order-pay request exists in the list, so none can be sent even by a future edit to a call site.
 * Responses are reduced to fixed words, times, the location name and this site's own notice address. A provider
 * message, host, key or token never leaves this module.
 */

/** Each provider call is time-boxed; a call that does not finish in this long reads "unavailable". */
export const SQUARE_TEST_TIMEOUT_MS = 8_000;

/** The notice types the app acts on (see `parseSquareWebhookEvent`): payments and refunds, created and updated. */
export const SQUARE_REQUIRED_NOTICE_EVENTS = ["payment.created", "payment.updated", "refund.created", "refund.updated"] as const;

/** The $1 test link, in cents. Never paid, deleted at once. */
export const SQUARE_TEST_LINK_AMOUNT_CENTS = 100;

export type SquareAllowedRequest = { name: string; method: "GET" | "POST" | "DELETE"; path: RegExp };

const id = "[A-Za-z0-9_-]{1,80}";
/** The whole list of Square requests this tester may send. Anything else is refused before it leaves the server. */
export const SQUARE_TESTER_ALLOWED_REQUESTS: readonly SquareAllowedRequest[] = Object.freeze([
  { name: "list locations (read)", method: "GET", path: /^\/v2\/locations$/ },
  { name: "read the location (read)", method: "GET", path: new RegExp(`^/v2/locations/${id}$`) },
  { name: "list notice subscriptions (read)", method: "GET", path: /^\/v2\/webhooks\/subscriptions$/ },
  { name: "send Square's test notice", method: "POST", path: new RegExp(`^/v2/webhooks/subscriptions/${id}/test$`) },
  { name: "create the $1 test link", method: "POST", path: /^\/v2\/online-checkout\/payment-links$/ },
  { name: "delete the test link", method: "DELETE", path: new RegExp(`^/v2/online-checkout/payment-links/${id}$`) },
]);

export class SquareRequestNotAllowedError extends Error {
  constructor() {
    super("That Square request is not one the System report tester may send.");
    this.name = "SquareRequestNotAllowedError";
  }
}

/** True when this method and path are on the allow-list. Exported so the tests can prove it. */
export function isAllowedSquareTesterRequest(method: string, pathname: string) {
  return SQUARE_TESTER_ALLOWED_REQUESTS.some((entry) => entry.method === method.toUpperCase() && entry.path.test(pathname));
}

/** The one choke point: checks the host, method and path, then sends with a time limit. */
export function createGuardedFetch(configuration: Pick<SquareRuntimeConfiguration, "apiUrl">, base: Fetcher = fetch): Fetcher {
  const origin = new URL(configuration.apiUrl).origin;
  return (async (input: Parameters<Fetcher>[0], init?: Parameters<Fetcher>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.origin !== origin || !isAllowedSquareTesterRequest(method, url.pathname)) throw new SquareRequestNotAllowedError();
    const limit = AbortSignal.timeout(SQUARE_TEST_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    return base(url.toString(), { ...init, method, signal, cache: "no-store" });
  }) as Fetcher;
}

export type SquareCheckKey = "account" | "location" | "notices" | "test" | "link";
export type SquareCheckState = "ok" | "attention" | "watch" | "unavailable" | "skipped" | "idle";

export type SquareCheckRow = {
  key: SquareCheckKey;
  state: SquareCheckState;
  /** A fixed sentence (plus the location name or this site's own address where the mockup shows them). */
  text: string;
  /** "Next:" step, a fixed sentence. */
  next: string | null;
  /** When the check finished, for the card's time display. */
  at: string | null;
  fixHref?: string;
  fixLabel?: string;
};

export type SquareLinkOutcome = "deleted" | "delete-failed" | "create-uncertain" | "not-run";

export type SquareTestResult = {
  ref: string;
  /** The test link's Square id when one was made (an id, never a secret), else null. */
  linkId: string | null;
  linkOutcome: SquareLinkOutcome;
  ranAt: string;
  linkTested: boolean;
  overall: "ok" | "attention" | "watch" | "unavailable";
  rows: SquareCheckRow[];
};

export type SquareTestDeps = {
  fetcher?: Fetcher;
  now?: () => Date;
  configuration?: SquareRuntimeConfiguration;
  ref?: string;
};

type Called = { kind: "ok"; body: Record<string, unknown>; status: number } | { kind: "refused"; status: number } | { kind: "unavailable" };

async function call(fetcher: Fetcher, configuration: SquareRuntimeConfiguration, method: "GET" | "POST", path: string, body?: unknown): Promise<Called> {
  try {
    const response = await fetcher(`${configuration.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${configuration.accessToken}`,
        "Square-Version": configuration.apiVersion,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = record(await response.json());
    } catch {
      parsed = {};
    }
    if (response.ok) return { kind: "ok", body: parsed, status: response.status };
    if (response.status === 429 || response.status >= 500) return { kind: "unavailable" };
    return { kind: "refused", status: response.status };
  } catch (error) {
    if (error instanceof SquareRequestNotAllowedError) throw error;
    return { kind: "unavailable" };
  }
}

const ROW_COPY = {
  unavailable: "Square did not answer in time. Try again in a minute.",
} as const;

const configIssueText: Record<string, string> = {
  PRODUCTION_DISABLED: "Production is selected but has not been switched on.",
  CREDENTIAL_ENVIRONMENT_MISMATCH: "The application id belongs to a different environment than the one selected.",
  INVALID_ENVIRONMENT: "The Square environment setting is not a valid value.",
  INVALID_API_URL: "The Square address setting does not match the environment.",
};

function envLabel(configuration: SquareRuntimeConfiguration) {
  return configuration.environment === "production" ? "Production" : "Sandbox";
}

function safeName(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) : "";
}

const skipped = (key: SquareCheckKey, text: string): SquareCheckRow => ({ key, state: "skipped", text, next: null, at: null });

function sameAddress(a: unknown, b: string) {
  if (typeof a !== "string") return false;
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch {
    return false;
  }
}

async function checkAccount(fetcher: Fetcher, configuration: SquareRuntimeConfiguration, now: () => Date): Promise<SquareCheckRow> {
  const base = { key: "account", fixHref: "/admin/settings", fixLabel: "Open payment settings" } as const;
  if (!configuration.paymentConfigured) {
    return {
      ...base, state: "attention", at: null,
      text: configIssueText[configuration.issue ?? ""] ?? "Square is not fully set up on this server.",
      next: "Check the Square settings (environment, application id, location id, access token, notice key and address), then run this again.",
    };
  }
  const result = await call(fetcher, configuration, "GET", "/v2/locations");
  if (result.kind === "ok") return { key: "account", state: "ok", text: `${envLabel(configuration)}. Token accepted.`, next: null, at: now().toISOString() };
  if (result.kind === "refused") {
    return {
      ...base, state: "attention", at: now().toISOString(),
      text: "Square refused the access token (expired or revoked).",
      next: `Make a new ${configuration.environment} access token in the Square Developer Dashboard, save it in the server settings, then run this again.`,
    };
  }
  return { key: "account", state: "unavailable", text: ROW_COPY.unavailable, next: null, at: now().toISOString() };
}

async function checkLocation(fetcher: Fetcher, configuration: SquareRuntimeConfiguration, now: () => Date): Promise<SquareCheckRow> {
  const result = await call(fetcher, configuration, "GET", `/v2/locations/${encodeURIComponent(configuration.locationId)}`);
  const at = now().toISOString();
  if (result.kind === "unavailable") return { key: "location", state: "unavailable", text: ROW_COPY.unavailable, next: null, at };
  if (result.kind === "refused") {
    return {
      key: "location", state: "attention", at,
      text: result.status === 404 ? "Square does not know the location id in the server settings." : "Square would not show the location with this token.",
      next: "Check the location id in the server settings and that the access token may read locations.",
    };
  }
  const location = record(result.body.location);
  const name = safeName(location.name);
  const label = name ? `“${name}”` : "The location";
  const capabilities = Array.isArray(location.capabilities) ? location.capabilities : [];
  if (location.status !== "ACTIVE") {
    return { key: "location", state: "attention", at, text: `${label} is not active in Square.`, next: "In Square, open Locations and make this location active, or choose another location id." };
  }
  if (!capabilities.includes("CREDIT_CARD_PROCESSING")) {
    return { key: "location", state: "watch", at, text: `${label} is active, but card payments are turned off.`, next: `In Square, open Locations${name ? ` → ${name}` : ""} and turn on card payments.` };
  }
  return { key: "location", state: "ok", at, text: `${label} is active and takes cards.`, next: null };
}

type NoticeCheck = { row: SquareCheckRow; subscriptionId: string | null; eventType: string | null };

async function checkNotices(fetcher: Fetcher, configuration: SquareRuntimeConfiguration, now: () => Date): Promise<NoticeCheck> {
  const result = await call(fetcher, configuration, "GET", "/v2/webhooks/subscriptions?include_disabled=true");
  const at = now().toISOString();
  const none = { subscriptionId: null, eventType: null };
  if (result.kind === "unavailable") return { ...none, row: { key: "notices", state: "unavailable", text: ROW_COPY.unavailable, next: null, at } };
  if (result.kind === "refused") {
    return { ...none, row: { key: "notices", state: "attention", at, text: "Square would not list notice subscriptions with this token.", next: "Allow the access token to read webhook subscriptions in the Square Developer Dashboard, then run this again." } };
  }
  const subscriptions = (Array.isArray(result.body.subscriptions) ? result.body.subscriptions : []).map(record);
  const here = subscriptions.filter((subscription) => sameAddress(subscription.notification_url, configuration.webhookNotificationUrl));
  const address = configuration.webhookNotificationUrl;
  if (here.length === 0) {
    return { ...none, row: { key: "notices", state: "attention", at, text: `No notice subscription points to this site's address (${address}).`, next: `In the Square Developer Dashboard, add a notice subscription with the address ${address} and tick ${SQUARE_REQUIRED_NOTICE_EVENTS.join(", ")}.` } };
  }
  const enabled = here.filter((subscription) => subscription.enabled === true);
  if (enabled.length === 0) {
    return { ...none, row: { key: "notices", state: "attention", at, text: "The notice subscription for this site exists but is turned off.", next: "In the Square Developer Dashboard, turn the notice subscription on." } };
  }
  const typesOf = (subscription: Record<string, unknown>) => (Array.isArray(subscription.event_types) ? subscription.event_types.filter((t): t is string => typeof t === "string") : []);
  const missingOf = (subscription: Record<string, unknown>) => SQUARE_REQUIRED_NOTICE_EVENTS.filter((type) => !typesOf(subscription).includes(type));
  const best = [...enabled].sort((a, b) => missingOf(a).length - missingOf(b).length)[0];
  const missing = missingOf(best);
  const subscriptionId = typeof best.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(best.id) ? best.id : null;
  const eventType = SQUARE_REQUIRED_NOTICE_EVENTS.find((type) => typesOf(best).includes(type)) ?? typesOf(best)[0] ?? null;
  if (missing.length > 0) {
    return { subscriptionId, eventType, row: { key: "notices", state: "attention", at, text: `Enabled and pointing here, but missing ${missing.join(", ")}.`, next: `In the Square Developer Dashboard, edit the notice subscription and tick ${missing.join(", ")}.` } };
  }
  return { subscriptionId, eventType, row: { key: "notices", state: "ok", at, text: `Enabled, points to this site, all ${SQUARE_REQUIRED_NOTICE_EVENTS.length} events included.`, next: null } };
}

async function checkTestNotice(fetcher: Fetcher, configuration: SquareRuntimeConfiguration, notice: NoticeCheck, now: () => Date): Promise<SquareCheckRow> {
  if (!notice.subscriptionId || !notice.eventType) return skipped("test", "Needs a notice subscription that points to this site first.");
  const started = now();
  const result = await call(fetcher, configuration, "POST", `/v2/webhooks/subscriptions/${notice.subscriptionId}/test`, { event_type: notice.eventType });
  const finished = now();
  const at = finished.toISOString();
  if (result.kind === "unavailable") return { key: "test", state: "unavailable", text: ROW_COPY.unavailable, next: null, at };
  if (result.kind === "refused") {
    return { key: "test", state: "attention", at, text: "Square would not send its test notice.", next: "Allow the access token to manage webhook subscriptions in the Square Developer Dashboard, then run this again." };
  }
  const code = record(result.body.subscription_test_result).status_code;
  const status = typeof code === "number" && Number.isInteger(code) ? code : null;
  const seconds = Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000));
  if (status !== null && status >= 200 && status < 300) {
    return { key: "test", state: "ok", at, text: `Arrived ${seconds === 0 ? "at once" : `${seconds} ${seconds === 1 ? "second" : "seconds"} after asking`}. Signature OK.`, next: null };
  }
  if (status === 503) {
    return { key: "test", state: "attention", at, text: "The test notice arrived, but this server's notice signature key is not set.", next: "Save the subscription's signature key in the server settings, then run this again.", fixHref: "/admin/settings", fixLabel: "Open payment settings" };
  }
  if (status === 400) {
    return { key: "test", state: "watch", at, text: "Arrived and the signature is ours, but the app could not read Square's sample notice.", next: null };
  }
  if (status === 403) {
    return { key: "test", state: "attention", at, text: "The test notice arrived, but the signature did not match.", next: "Copy the subscription's signature key from Square into the server settings. Until then, payment notices are being ignored." };
  }
  return { key: "test", state: "attention", at, text: "The test notice did not arrive.", next: "Check that this site is reachable from the internet at the notice address, then run this again." };
}

type LinkCheck = { row: SquareCheckRow; linkId: string | null; outcome: SquareLinkOutcome };

async function checkLink(fetcher: Fetcher, configuration: SquareRuntimeConfiguration, ref: string, now: () => Date): Promise<LinkCheck> {
  let created: SquarePaymentLinkResult | null = null;
  let madeAt: string | null = null;
  let failure: SquareCheckRow | null = null;
  let outcome: SquareLinkOutcome = "not-run";
  try {
    created = await createSquarePaymentLink(configuration, {
      idempotencyKey: randomUUID(),
      amountCents: SQUARE_TEST_LINK_AMOUNT_CENTS,
      currency: "USD",
      locationId: configuration.locationId,
      referenceId: `system-test-${ref}`,
      itemName: "IMSDA Events System report test (never paid)",
      paymentNote: "System report test. Not a real payment.",
      redirectUrl: new URL("/", configuration.webhookNotificationUrl).toString(),
    }, fetcher);
    madeAt = now().toISOString();
  } catch (error) {
    if (error instanceof SquareRequestNotAllowedError) throw error;
    const uncertain = error instanceof SquareAdapterError
      && (error.code === "SQUARE_REQUEST_UNCERTAIN" || error.code === "SQUARE_INVALID_RESPONSE");
    if (created) {
      failure = { key: "link", state: "attention", text: "The test link was made, but the check stopped early. It is being deleted.", next: null, at: madeAt };
    } else if (uncertain) {
      // Square may have made the link even though no answer came back: the admin must look for it.
      outcome = "create-uncertain";
      failure = {
        key: "link", state: "unavailable", at: null,
        text: "Square did not confirm whether the test link was made.",
        next: `Look for order reference system-test-${ref} in Square → Online checkout and delete it if it is there.`,
      };
    } else {
      failure = { key: "link", state: "attention", text: "Square would not make a test payment link.", next: "Check that the location takes card payments and the access token may create payment links.", at: null };
    }
  } finally {
    // Always runs once a link exists, even if the lines above threw after creating it.
    if (created) {
      const linkId = created.id;
      try {
        await deleteSquarePaymentLink(configuration, linkId, fetcher);
        outcome = "deleted";
        failure = failure ?? { key: "link", state: "ok", at: now().toISOString(), text: "Made and deleted at once. Never paid.", next: null };
      } catch (error) {
        if (error instanceof SquareRequestNotAllowedError) throw error;
        outcome = "delete-failed";
        failure = {
          key: "link", state: "attention", at: madeAt,
          text: "Made, but could not be deleted.",
          next: `Delete link ${linkId} in Square → Online checkout now, so no one can pay it.`,
        };
      }
    }
  }
  const row = failure ?? { key: "link" as const, state: "attention" as const, text: "The test link did not complete.", next: null, at: null };
  return { row, linkId: created?.id ?? null, outcome };
}

function overallOf(rows: SquareCheckRow[]): SquareTestResult["overall"] {
  if (rows.some((row) => row.state === "attention")) return "attention";
  if (rows.some((row) => row.state === "watch")) return "watch";
  if (rows.some((row) => row.state === "unavailable" || row.state === "skipped")) return "unavailable";
  return "ok";
}

/** Runs the checks in order. A failed account check skips the rest. The link check runs only when asked for. */
export async function runSquareChecks(input: { includeLink: boolean }, deps: SquareTestDeps = {}): Promise<SquareTestResult> {
  const now = deps.now ?? (() => new Date());
  const configuration = deps.configuration ?? getSquareConfiguration();
  const fetcher = createGuardedFetch(configuration, deps.fetcher ?? fetch);
  const ref = deps.ref ?? newSystemTestRef();
  const ranAt = now().toISOString();

  let linkId: string | null = null;
  let linkOutcome: SquareLinkOutcome = "not-run";
  const account = await checkAccount(fetcher, configuration, now);
  const rows: SquareCheckRow[] = [account];
  const needsAccount = "Needs a working account first.";
  if (account.state !== "ok") {
    rows.push(skipped("location", needsAccount), skipped("notices", needsAccount), skipped("test", needsAccount));
    if (input.includeLink) rows.push(skipped("link", needsAccount));
  } else {
    rows.push(await checkLocation(fetcher, configuration, now));
    const notices = await checkNotices(fetcher, configuration, now);
    rows.push(notices.row);
    rows.push(await checkTestNotice(fetcher, configuration, notices, now));
    if (input.includeLink) {
      const link = await checkLink(fetcher, configuration, ref, now);
      rows.push(link.row);
      linkId = link.linkId;
      linkOutcome = link.outcome;
    }
  }
  return { ref, linkId, linkOutcome, ranAt, linkTested: input.includeLink, overall: overallOf(rows), rows };
}

export type SquareTestRun =
  | { kind: "rate-limited"; nextAllowedAt: string }
  | { kind: "ran"; result: SquareTestResult };

/** Charges the hourly limit, runs the checks, and writes one audit row with ids and fixed outcome codes only. */
export async function runSquareTest(input: { user: { id: string }; includeLink: boolean; now?: Date }, deps: SquareTestDeps = {}): Promise<SquareTestRun> {
  const limit = await checkSystemSquareTestRateLimit(input.user.id);
  if (!limit.allowed) return { kind: "rate-limited", nextAllowedAt: nextAllowedAt(limit, input.now ?? new Date()).toISOString() };
  const result = await runSquareChecks({ includeLink: input.includeLink }, deps);
  try {
    await writeAuditLog({
      actorUserId: input.user.id,
      action: "SYSTEM_REPORT_SQUARE_TEST",
      entityType: "SquareTest",
      entityId: result.ref,
      summary: "A system administrator ran the System report Square tester.",
      metadata: {
        testRef: result.ref,
        linkTested: result.linkTested,
        linkId: result.linkId,
        linkOutcome: result.linkOutcome,
        overall: result.overall,
        outcomes: Object.fromEntries(result.rows.map((row) => [row.key, row.state])),
      },
    });
  } catch (error) {
    logError("Could not audit a System report Square test", error, { testRef: result.ref });
  }
  return { kind: "ran", result };
}
