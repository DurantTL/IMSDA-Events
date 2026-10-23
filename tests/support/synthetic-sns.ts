import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

/**
 * Synthetic SNS material for tests (#863): a throw-away RSA key pair, a self-signed X.509 certificate for it built here
 * (no openssl, no files), and signed SNS envelopes. Nothing here is, or is derived from, real AWS material.
 */

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length = body.length < 128
    ? Buffer.from([body.length])
    : body.length < 256
      ? Buffer.from([0x81, body.length])
      : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

function derName(commonName: string): Buffer {
  const oidCommonName = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  return der(0x30, der(0x31, der(0x30, oidCommonName, der(0x0c, Buffer.from(commonName)))));
}

function utcTime(date: Date): Buffer {
  const pad = (value: number) => String(value).padStart(2, "0");
  const text = `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(text));
}

export type SyntheticCertificate = { privateKey: KeyObject; pem: string };

export function createSyntheticCertificate(options: { notBefore: Date; notAfter: Date; subject?: string; issuer?: string }): SyntheticCertificate {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sha256WithRsa = der(0x30, Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), Buffer.from([0x05, 0x00]));
  // Like the real one: a certificate for sns.amazonaws.com from an Amazon issuer (here a synthetic one).
  const subject = derName(options.subject ?? "sns.amazonaws.com");
  const issuer = derName(options.issuer ?? "Amazon Synthetic Test CA");
  const tbs = der(
    0x30,
    Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]),
    der(0x02, Buffer.from([0x01])),
    sha256WithRsa,
    issuer,
    der(0x30, utcTime(options.notBefore), utcTime(options.notAfter)),
    subject,
    publicKey.export({ type: "spki", format: "der" }) as Buffer,
  );
  const signature = createSign("RSA-SHA256").update(tbs).sign(privateKey);
  const certificate = der(0x30, tbs, sha256WithRsa, der(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
  const base64 = certificate.toString("base64").match(/.{1,64}/g)!.join("\n");
  return { privateKey, pem: `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n` };
}

export const SYNTHETIC_REGION = "us-east-2";
export const SYNTHETIC_ACCOUNT = "123456789012";
export const SYNTHETIC_TOPIC_ARN = `arn:aws:sns:${SYNTHETIC_REGION}:${SYNTHETIC_ACCOUNT}:synthetic-ses-events`;
export const SYNTHETIC_CERT_URL = `https://sns.${SYNTHETIC_REGION}.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem`;
export const SYNTHETIC_NOW_TIMESTAMP = "2026-10-23T12:00:00.000Z";

export const syntheticSnsEnvironment = {
  SES_SNS_TOPIC_ARN: SYNTHETIC_TOPIC_ARN,
  SES_AWS_ACCOUNT_ID: SYNTHETIC_ACCOUNT,
};

export type SignOptions = {
  type?: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  version?: "1" | "2";
  messageId?: string;
  message?: string;
  subject?: string;
  topicArn?: string;
  certUrl?: string;
  subscribeUrl?: string;
  token?: string;
  timestamp?: string;
};

/** Builds and signs an envelope the way SNS does: alphabetical `Name\nValue\n` over the fields for the type. */
export function signedSnsEnvelope(privateKey: KeyObject, options: SignOptions = {}) {
  const type = options.type ?? "Notification";
  const version = options.version ?? "2";
  const envelope: Record<string, string> = {
    Type: type,
    MessageId: options.messageId ?? "11111111-2222-3333-4444-555555555555",
    TopicArn: options.topicArn ?? SYNTHETIC_TOPIC_ARN,
    Message: options.message ?? "{}",
    Timestamp: options.timestamp ?? "2026-10-23T12:00:00.000Z",
    SignatureVersion: version,
    SigningCertURL: options.certUrl ?? SYNTHETIC_CERT_URL,
  };
  if (options.subject !== undefined) envelope.Subject = options.subject;
  if (type !== "Notification") {
    envelope.Token = options.token ?? "synthetic-token-0001";
    envelope.SubscribeURL = options.subscribeUrl
      ?? `https://sns.${SYNTHETIC_REGION}.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(envelope.TopicArn)}&Token=${envelope.Token}`;
  }
  const fields = type === "Notification"
    ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  const canonical = fields.filter((name) => envelope[name] !== undefined).map((name) => `${name}\n${envelope[name]}\n`).join("");
  envelope.Signature = createSign(version === "2" ? "RSA-SHA256" : "RSA-SHA1").update(canonical, "utf8").sign(privateKey, "base64");
  return envelope;
}

export type SyntheticSesEvent = {
  type: "Bounce" | "Complaint" | "Delivery";
  /** `identity` uses `notificationType`; `event` uses configuration-set `eventType`. */
  format?: "identity" | "event";
  messageId?: string;
  accountId?: string;
  bounceType?: string;
  bounceSubType?: string;
  recipients?: string[];
  timestamp?: string;
};

/** A synthetic SES notification body (the `Message` of an SNS Notification). Addresses are fictitious `example.test`. */
export function sesNotificationMessage(event: SyntheticSesEvent): string {
  const timestamp = event.timestamp ?? "2026-10-23T12:00:00.000Z";
  const recipients = event.recipients ?? ["bounced.person@example.test"];
  const body: Record<string, unknown> = {
    [event.format === "event" ? "eventType" : "notificationType"]: event.type,
    mail: {
      timestamp,
      messageId: event.messageId ?? "0100synthetic-ses-message-id-000001",
      sendingAccountId: event.accountId ?? SYNTHETIC_ACCOUNT,
      destination: recipients,
    },
  };
  if (event.type === "Bounce") {
    body.bounce = {
      bounceType: event.bounceType ?? "Permanent",
      bounceSubType: event.bounceSubType ?? "General",
      timestamp,
      bouncedRecipients: recipients.map((emailAddress) => ({ emailAddress })),
    };
  } else if (event.type === "Complaint") {
    body.complaint = { timestamp, complainedRecipients: recipients.map((emailAddress) => ({ emailAddress })) };
  } else {
    body.delivery = { timestamp, recipients };
  }
  return JSON.stringify(body);
}
