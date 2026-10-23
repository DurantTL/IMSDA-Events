import "server-only";

import { X509Certificate, createVerify } from "node:crypto";
import { z } from "zod";
import { normalizeSesMessageId } from "./ses";

/**
 * Amazon SNS delivery of SES bounce, complaint and delivery reports (#863).
 *
 * Nothing here trusts the request until the SNS signature checks out, and nothing is fetched from an address the payload
 * chose unless it is exactly the AWS SNS host of the configured topic's region:
 *
 * 1. the body is at most 256 KB and a JSON object, and the `x-amz-sns-message-type` header agrees with its `Type`;
 * 2. `TopicArn` equals the one allowed topic (`SES_SNS_TOPIC_ARN`), before anything else is looked at;
 * 3. `SigningCertURL` must be `https://sns.<region>.amazonaws.com/SimpleNotificationService-<id>.pem` for the topic's own
 *    region (no other host, port, credentials, query or redirect), and only then is it fetched;
 * 4. the signature is checked over the canonical string AWS defines for that message type, using SHA1 for
 *    `SignatureVersion` 1 and SHA256 for 2;
 * 5. the notification must name the allowed AWS account as the sender (`mail.sendingAccountId`).
 *
 * A subscription confirmation is handled narrowly (see `confirmSnsSubscription`): only the verified message of the
 * allowed topic, only its own `SubscribeURL` on the same AWS host, nothing else.
 */

export const SNS_MAX_BODY_BYTES = 256 * 1024;
const CERTIFICATE_MAX_BYTES = 16 * 1024;
const CERTIFICATE_TIMEOUT_MS = 5_000;
const CERTIFICATE_CACHE_MS = 60 * 60 * 1000;
const CERTIFICATE_CACHE_LIMIT = 8;
const MAX_RECIPIENTS_PER_NOTIFICATION = 50;

/** The environment does not allow any SNS topic yet. The endpoint answers 503 and SNS retries. */
export class SnsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnsConfigurationError";
  }
}

/** The request is not a valid, allowed SNS message. Permanent: the endpoint answers 4xx and SNS stops retrying. */
export class SnsVerificationError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 413 = 400) {
    super(message);
    this.name = "SnsVerificationError";
  }
}

/** AWS could not be reached right now (the signing certificate or the confirmation address). Retryable: the endpoint answers 503. */
export class SnsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnsUnavailableError";
  }
}

export type SnsConfiguration = { topicArn: string; accountId: string; region: string };

const TOPIC_ARN_PATTERN = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d{1,2}):(\d{12}):[A-Za-z0-9_-]{1,256}$/;

/** The allowed topic and account from the environment, or null when either is missing or they disagree. */
export function getSnsConfiguration(env: Record<string, string | undefined> = process.env): SnsConfiguration | null {
  const topicArn = env.SES_SNS_TOPIC_ARN?.trim();
  const accountId = env.SES_AWS_ACCOUNT_ID?.trim();
  if (!topicArn || !accountId) return null;
  const match = TOPIC_ARN_PATTERN.exec(topicArn);
  if (!match || match[2] !== accountId) return null;
  return { topicArn, accountId, region: match[1]! };
}

const snsEnvelopeSchema = z.object({
  Type: z.enum(["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]),
  MessageId: z.string().trim().min(1).max(200),
  TopicArn: z.string().trim().min(1).max(512),
  Message: z.string().max(SNS_MAX_BODY_BYTES),
  Timestamp: z.string().trim().min(1).max(64),
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string().trim().min(1).max(4096),
  SigningCertURL: z.string().trim().min(1).max(512),
  Subject: z.string().max(1024).optional(),
  Token: z.string().max(1024).optional(),
  SubscribeURL: z.string().max(2048).optional(),
}).loose();

export type SnsEnvelope = z.infer<typeof snsEnvelopeSchema>;

/** The fields AWS signs, in the order it signs them (alphabetical), for each message type. */
const NOTIFICATION_SIGNED_FIELDS = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const;
const CONFIRMATION_SIGNED_FIELDS = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const;

/**
 * The string SNS signs: for each signed field present, `Name\nValue\n`. `Subject` is left out of a notification that has
 * none; every other listed field is required and a missing one is a verification failure.
 */
export function buildSnsCanonicalString(envelope: SnsEnvelope): string {
  const fields = envelope.Type === "Notification" ? NOTIFICATION_SIGNED_FIELDS : CONFIRMATION_SIGNED_FIELDS;
  let canonical = "";
  for (const name of fields) {
    const value = (envelope as Record<string, unknown>)[name];
    if (value === undefined || value === null) {
      if (name === "Subject") continue;
      throw new SnsVerificationError("The SNS message is missing a signed field.");
    }
    if (typeof value !== "string") throw new SnsVerificationError("The SNS message has a malformed signed field.");
    canonical += `${name}\n${value}\n`;
  }
  return canonical;
}

const SIGNING_CERT_PATH = /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/;

/** Parses a URL that must be on `sns.<region>.amazonaws.com` over https, or returns null. Never fetches anything. */
function parseSnsHostUrl(value: string, region: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== `sns.${region}.amazonaws.com`
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
  ) return null;
  return url;
}

/** The signing certificate address, only when it is the AWS SNS certificate path on the topic's region host. */
export function parseSigningCertUrl(value: string, region: string): URL | null {
  const url = parseSnsHostUrl(value, region);
  if (!url || url.search !== "" || !SIGNING_CERT_PATH.test(url.pathname)) return null;
  return url;
}

/**
 * The confirmation address, only when it is the SNS host root with exactly `Action=ConfirmSubscription`, this topic's ARN
 * and this message's own token, and no other parameter.
 */
export function parseSubscribeUrl(value: string, config: SnsConfiguration, token: string): URL | null {
  const url = parseSnsHostUrl(value, config.region);
  if (!url || url.pathname !== "/") return null;
  const entries = [...url.searchParams.entries()];
  const params = new Map(entries);
  if (entries.length !== 3 || params.size !== 3) return null;
  if (params.get("Action") !== "ConfirmSubscription") return null;
  if (params.get("TopicArn") !== config.topicArn) return null;
  if (!token || params.get("Token") !== token) return null;
  return url;
}

export type SnsFetch = (url: string, init: { redirect: "error"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Pick<Response, "ok" | "status" | "text">>;

export type SnsVerifierDependencies = {
  /** Fetches the signing certificate PEM from an already validated URL. Tests supply their own. */
  fetchCertificate?: (url: string) => Promise<string>;
  now?: () => Date;
};

const certificateCache = new Map<string, { pem: string; at: number }>();

/** Test hook: forget every cached certificate. */
export function resetSnsCertificateCache() {
  certificateCache.clear();
}

async function defaultFetchCertificate(url: string): Promise<string> {
  const cached = certificateCache.get(url);
  if (cached && Date.now() - cached.at < CERTIFICATE_CACHE_MS) return cached.pem;
  let pem: string;
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(CERTIFICATE_TIMEOUT_MS), headers: { accept: "application/x-pem-file, text/plain" } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    pem = await response.text();
  } catch {
    throw new SnsUnavailableError("The SNS signing certificate could not be fetched right now.");
  }
  if (pem.length > CERTIFICATE_MAX_BYTES) throw new SnsVerificationError("The SNS signing certificate is not valid.");
  if (certificateCache.size >= CERTIFICATE_CACHE_LIMIT) certificateCache.clear();
  certificateCache.set(url, { pem, at: Date.now() });
  return pem;
}

function headerValue(headers: Headers, name: string) {
  return headers.get(name)?.trim() ?? "";
}

export type VerifiedSnsMessage = { config: SnsConfiguration; envelope: SnsEnvelope };

/**
 * Verifies one SNS HTTP request end to end. Throws `SnsConfigurationError` (not configured), `SnsVerificationError`
 * (permanently invalid) or `SnsUnavailableError` (retry). Returns only a message that is signed by AWS for the
 * allowed topic.
 */
export async function verifySnsRequest(
  rawBody: string,
  headers: Headers,
  environment: Record<string, string | undefined> = process.env,
  dependencies: SnsVerifierDependencies = {},
): Promise<VerifiedSnsMessage> {
  const config = getSnsConfiguration(environment);
  if (!config) {
    throw new SnsConfigurationError("The SES notification topic and AWS account are not configured.");
  }
  if (Buffer.byteLength(rawBody, "utf8") > SNS_MAX_BODY_BYTES) {
    throw new SnsVerificationError("The SNS message is too large.", 413);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new SnsVerificationError("The SNS message is not valid JSON.");
  }
  const parsed = snsEnvelopeSchema.safeParse(parsedJson);
  if (!parsed.success) throw new SnsVerificationError("The SNS message is not a valid envelope.");
  const envelope = parsed.data;
  const headerType = headerValue(headers, "x-amz-sns-message-type");
  if (!headerType || headerType !== envelope.Type) {
    throw new SnsVerificationError("The SNS message type header does not match the message.");
  }
  // The topic first: a message for any other topic is refused before a certificate is fetched for it.
  if (envelope.TopicArn !== config.topicArn) {
    throw new SnsVerificationError("This SNS topic is not allowed.", 403);
  }
  const certificateUrl = parseSigningCertUrl(envelope.SigningCertURL, config.region);
  if (!certificateUrl) throw new SnsVerificationError("The SNS signing certificate address is not allowed.");
  if (envelope.Type !== "Notification" && (!envelope.Token || !envelope.SubscribeURL)) {
    throw new SnsVerificationError("The SNS confirmation message is incomplete.");
  }
  const canonical = buildSnsCanonicalString(envelope);

  const now = (dependencies.now ?? (() => new Date()))();
  const pem = await (dependencies.fetchCertificate ?? defaultFetchCertificate)(certificateUrl.toString());
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new SnsVerificationError("The SNS signing certificate is not valid.");
  }
  if (now < new Date(certificate.validFrom) || now > new Date(certificate.validTo)) {
    throw new SnsVerificationError("The SNS signing certificate is not valid right now.");
  }
  const signature = Buffer.from(envelope.Signature, "base64");
  const algorithm = envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  let valid = false;
  try {
    valid = createVerify(algorithm).update(canonical, "utf8").verify(certificate.publicKey, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new SnsVerificationError("The SNS signature is not valid.");
  return { config, envelope };
}

/**
 * Confirms the subscription of the allowed topic, and nothing else. Only called with a verified message. The address is
 * the message's own `SubscribeURL`, accepted only when `parseSubscribeUrl` finds exactly the SNS host root with this
 * topic and this token. One GET, no redirects, a short timeout, and the body is never read.
 */
export async function confirmSnsSubscription(
  verified: VerifiedSnsMessage,
  fetchImpl: SnsFetch = fetch as unknown as SnsFetch,
): Promise<void> {
  const { envelope, config } = verified;
  if (envelope.Type !== "SubscriptionConfirmation") {
    throw new SnsVerificationError("This SNS message is not a subscription confirmation.");
  }
  const url = parseSubscribeUrl(envelope.SubscribeURL ?? "", config, envelope.Token ?? "");
  if (!url) throw new SnsVerificationError("The SNS confirmation address is not allowed.");
  let response: Pick<Response, "ok" | "status" | "text">;
  try {
    response = await fetchImpl(url.toString(), { redirect: "error", signal: AbortSignal.timeout(CERTIFICATE_TIMEOUT_MS), headers: { accept: "text/xml" } });
  } catch {
    throw new SnsUnavailableError("The SNS subscription could not be confirmed right now.");
  }
  if (!response.ok) throw new SnsUnavailableError("The SNS subscription could not be confirmed right now.");
}

// --- SES notifications carried in an SNS Notification -------------------------------------------------------------

export type SesFeedbackKind = "DELIVERY" | "HARD_BOUNCE" | "SOFT_BOUNCE" | "COMPLAINT";

export type SesFeedback = {
  kind: SesFeedbackKind;
  /** The neutral event name stored on `MessageProviderEvent.eventType`. */
  eventType: "ses.delivery" | "ses.bounce.permanent" | "ses.bounce.transient" | "ses.bounce.undetermined" | "ses.complaint";
  /** The normalized SES message id (`mail.messageId`), the key the outbox row is matched by. */
  providerMessageId: string;
  occurredAt: Date;
  /** Normalized addresses, only for a hard bounce or complaint (the ones suppression needs); empty otherwise. */
  suppressRecipients: string[];
  /** Ids and counts that are safe to store and log. */
  details: { bounceType?: string; bounceSubType?: string; recipientCount: number };
};

const recipientListSchema = z.array(z.object({ emailAddress: z.string().max(320) }).loose()).max(1000);

const sesNotificationSchema = z.object({
  notificationType: z.string().optional(),
  eventType: z.string().optional(),
  mail: z.object({
    messageId: z.string().min(1).max(512),
    timestamp: z.string().optional(),
    sendingAccountId: z.string().regex(/^\d{12}$/),
  }).loose(),
  bounce: z.object({
    bounceType: z.string().max(64),
    bounceSubType: z.string().max(64).optional(),
    timestamp: z.string().optional(),
    bouncedRecipients: recipientListSchema.default([]),
  }).loose().optional(),
  complaint: z.object({
    timestamp: z.string().optional(),
    complainedRecipients: recipientListSchema.default([]),
  }).loose().optional(),
  delivery: z.object({
    timestamp: z.string().optional(),
    recipients: z.array(z.string()).max(1000).default([]),
  }).loose().optional(),
}).loose();

const emailAddressSchema = z.email();

/** Addresses are compared trimmed and lower-cased everywhere suppression looks at one. */
function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedRecipients(list: Array<{ emailAddress: string }>): string[] {
  const addresses = new Set<string>();
  for (const entry of list) {
    const address = normalizeAddress(entry.emailAddress);
    if (emailAddressSchema.safeParse(address).success) addresses.add(address);
    if (addresses.size >= MAX_RECIPIENTS_PER_NOTIFICATION) break;
  }
  return [...addresses];
}

/**
 * Reads the SES notification in a verified SNS Notification. Returns `null` for a notification this system does not act
 * on (a send, a reject, a delivery delay, an open, an SNS test message), so it is acknowledged and dropped. A bounce,
 * complaint or delivery that is not well formed, or that names another AWS account, is a `SnsVerificationError`.
 *
 * Both SES formats are read: identity notifications (`notificationType`) and configuration-set event publishing
 * (`eventType`). A permanent bounce is a hard bounce (suppresses); a transient or undetermined one is recorded only.
 */
export function parseSesNotification(envelope: SnsEnvelope, config: SnsConfiguration): SesFeedback | null {
  let json: unknown;
  try {
    json = JSON.parse(envelope.Message);
  } catch {
    throw new SnsVerificationError("The SES notification is not valid JSON.");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new SnsVerificationError("The SES notification is not an object.");
  }
  const typeValue = (json as { eventType?: unknown; notificationType?: unknown }).eventType
    ?? (json as { notificationType?: unknown }).notificationType;
  const type = typeof typeValue === "string" ? typeValue.toLowerCase() : "";
  if (type !== "bounce" && type !== "complaint" && type !== "delivery") return null;

  const parsed = sesNotificationSchema.safeParse(json);
  if (!parsed.success) throw new SnsVerificationError("The SES notification is not well formed.");
  const notification = parsed.data;
  if (notification.mail.sendingAccountId !== config.accountId) {
    throw new SnsVerificationError("The SES notification is from an AWS account that is not allowed.", 403);
  }
  const providerMessageId = normalizeSesMessageId(notification.mail.messageId);
  if (!providerMessageId) throw new SnsVerificationError("The SES message id is not valid.");
  const fallback = validDate(envelope.Timestamp) ?? new Date(0);

  if (type === "delivery") {
    if (!notification.delivery) throw new SnsVerificationError("The SES delivery notification has no delivery.");
    return {
      kind: "DELIVERY",
      eventType: "ses.delivery",
      providerMessageId,
      occurredAt: validDate(notification.delivery.timestamp) ?? validDate(notification.mail.timestamp) ?? fallback,
      suppressRecipients: [],
      details: { recipientCount: notification.delivery.recipients.length },
    };
  }
  if (type === "complaint") {
    if (!notification.complaint) throw new SnsVerificationError("The SES complaint notification has no complaint.");
    const recipients = normalizedRecipients(notification.complaint.complainedRecipients);
    return {
      kind: "COMPLAINT",
      eventType: "ses.complaint",
      providerMessageId,
      occurredAt: validDate(notification.complaint.timestamp) ?? validDate(notification.mail.timestamp) ?? fallback,
      suppressRecipients: recipients,
      details: { recipientCount: notification.complaint.complainedRecipients.length },
    };
  }
  if (!notification.bounce) throw new SnsVerificationError("The SES bounce notification has no bounce.");
  const bounceType = notification.bounce.bounceType;
  const permanent = bounceType.toLowerCase() === "permanent";
  const transient = bounceType.toLowerCase() === "transient";
  return {
    kind: permanent ? "HARD_BOUNCE" : "SOFT_BOUNCE",
    eventType: permanent ? "ses.bounce.permanent" : transient ? "ses.bounce.transient" : "ses.bounce.undetermined",
    providerMessageId,
    occurredAt: validDate(notification.bounce.timestamp) ?? validDate(notification.mail.timestamp) ?? fallback,
    suppressRecipients: permanent ? normalizedRecipients(notification.bounce.bouncedRecipients) : [],
    details: {
      bounceType,
      ...(notification.bounce.bounceSubType ? { bounceSubType: notification.bounce.bounceSubType } : {}),
      recipientCount: notification.bounce.bouncedRecipients.length,
    },
  };
}
