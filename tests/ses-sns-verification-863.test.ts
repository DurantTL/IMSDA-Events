import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SnsConfigurationError,
  SnsUnavailableError,
  SnsVerificationError,
  buildSnsCanonicalString,
  SNS_MAX_BODY_BYTES,
  confirmSnsSubscription,
  getSnsConfiguration,
  parseSesNotification,
  parseSigningCertUrl,
  parseSubscribeUrl,
  readSnsBody,
  resetSnsCertificateCache,
  verifySnsRequest,
  type SnsEnvelope,
} from "@/integrations/email/ses-sns";
import { getSesEmailAvailability, messageIdFromResponse, normalizeSesMessageId } from "@/integrations/email/ses";
import {
  SYNTHETIC_ACCOUNT,
  SYNTHETIC_CERT_URL,
  SYNTHETIC_REGION,
  SYNTHETIC_TOPIC_ARN,
  createSyntheticCertificate,
  sesNotificationMessage,
  signedSnsEnvelope,
  syntheticSnsEnvironment,
  type SyntheticCertificate,
} from "./support/synthetic-sns";

const now = new Date("2026-10-23T12:05:00.000Z");
let certificate: SyntheticCertificate;
let other: SyntheticCertificate;
let expired: SyntheticCertificate;

beforeAll(() => {
  certificate = createSyntheticCertificate({ notBefore: new Date("2026-01-01T00:00:00Z"), notAfter: new Date("2027-01-01T00:00:00Z") });
  other = createSyntheticCertificate({ notBefore: new Date("2026-01-01T00:00:00Z"), notAfter: new Date("2027-01-01T00:00:00Z") });
  expired = createSyntheticCertificate({ notBefore: new Date("2024-01-01T00:00:00Z"), notAfter: new Date("2025-01-01T00:00:00Z") });
});

const headersFor = (type: string) => new Headers({ "x-amz-sns-message-type": type });

function verify(envelope: Record<string, string>, options: { type?: string; pem?: string; env?: Record<string, string | undefined> } = {}) {
  const fetchCertificate = vi.fn(async () => options.pem ?? certificate.pem);
  const promise = verifySnsRequest(
    JSON.stringify(envelope),
    headersFor(options.type ?? envelope.Type!),
    options.env ?? syntheticSnsEnvironment,
    { fetchCertificate, now: () => now },
  );
  return { promise, fetchCertificate };
}

describe("SNS signature verification (#863)", () => {
  it.each(["1", "2"] as const)("accepts a correctly signed notification with SignatureVersion %s", async (version) => {
    const envelope = signedSnsEnvelope(certificate.privateKey, { version, subject: "Amazon SES Email Event Notification", message: sesNotificationMessage({ type: "Delivery" }) });
    const { promise, fetchCertificate } = verify(envelope);
    const verified = await promise;
    expect(verified.envelope.MessageId).toBe(envelope.MessageId);
    expect(fetchCertificate).toHaveBeenCalledWith(SYNTHETIC_CERT_URL);
  });

  it("signs a notification without a Subject over the fields it has", async () => {
    const envelope = signedSnsEnvelope(certificate.privateKey, {});
    expect(envelope.Subject).toBeUndefined();
    await expect(verify(envelope).promise).resolves.toBeTruthy();
  });

  it("builds the canonical string per message type, alphabetically, Subject only when present", () => {
    const notification = { Type: "Notification", MessageId: "m", TopicArn: "t", Message: "x", Timestamp: "ts" } as unknown as SnsEnvelope;
    expect(buildSnsCanonicalString(notification)).toBe("Message\nx\nMessageId\nm\nTimestamp\nts\nTopicArn\nt\nType\nNotification\n");
    expect(buildSnsCanonicalString({ ...notification, Subject: "s" } as SnsEnvelope)).toBe("Message\nx\nMessageId\nm\nSubject\ns\nTimestamp\nts\nTopicArn\nt\nType\nNotification\n");
    const confirmation = { Type: "SubscriptionConfirmation", MessageId: "m", TopicArn: "t", Message: "x", Timestamp: "ts", Token: "k", SubscribeURL: "u" } as unknown as SnsEnvelope;
    expect(buildSnsCanonicalString(confirmation)).toBe("Message\nx\nMessageId\nm\nSubscribeURL\nu\nTimestamp\nts\nToken\nk\nTopicArn\nt\nType\nSubscriptionConfirmation\n");
  });

  it("rejects a message changed after signing, a signature from another key, and a wrong version", async () => {
    const signed = signedSnsEnvelope(certificate.privateKey, { message: sesNotificationMessage({ type: "Delivery" }) });
    await expect(verify({ ...signed, Message: sesNotificationMessage({ type: "Bounce" }) }).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify({ ...signed, MessageId: "someone-else" }).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify(signedSnsEnvelope(other.privateKey, {})).promise).rejects.toBeInstanceOf(SnsVerificationError);
    // A version 2 signature presented as version 1 does not verify (SHA1 over the same string).
    await expect(verify({ ...signed, SignatureVersion: "1" }).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify({ ...signed, SignatureVersion: "3" }).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify({ ...signed, Signature: "!!!not-base64!!!" }).promise).rejects.toBeInstanceOf(SnsVerificationError);
  });

  it("refuses a certificate that is expired or not a certificate", async () => {
    const signed = signedSnsEnvelope(expired.privateKey, {});
    await expect(verify(signed, { pem: expired.pem }).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify(signedSnsEnvelope(certificate.privateKey, {}), { pem: "not a certificate" }).promise).rejects.toBeInstanceOf(SnsVerificationError);
  });

  it("allows only the configured topic, before any certificate is fetched", async () => {
    const otherTopic = signedSnsEnvelope(certificate.privateKey, { topicArn: `arn:aws:sns:${SYNTHETIC_REGION}:${SYNTHETIC_ACCOUNT}:another-topic` });
    const { promise, fetchCertificate } = verify(otherTopic);
    await expect(promise).rejects.toMatchObject({ name: "SnsVerificationError", status: 403 });
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it("is not configured without both the topic and the account, or when they disagree", async () => {
    const envelope = signedSnsEnvelope(certificate.privateKey, {});
    await expect(verify(envelope, { env: {} }).promise).rejects.toBeInstanceOf(SnsConfigurationError);
    await expect(verify(envelope, { env: { SES_SNS_TOPIC_ARN: SYNTHETIC_TOPIC_ARN } }).promise).rejects.toBeInstanceOf(SnsConfigurationError);
    await expect(verify(envelope, { env: { SES_SNS_TOPIC_ARN: SYNTHETIC_TOPIC_ARN, SES_AWS_ACCOUNT_ID: "999999999999" } }).promise).rejects.toBeInstanceOf(SnsConfigurationError);
    expect(getSnsConfiguration(syntheticSnsEnvironment)).toEqual({ topicArn: SYNTHETIC_TOPIC_ARN, accountId: SYNTHETIC_ACCOUNT, region: SYNTHETIC_REGION, minSignatureVersion: "1" });
    expect(getSnsConfiguration({ ...syntheticSnsEnvironment, SES_SNS_SIGNATURE_VERSION: "2" })?.minSignatureVersion).toBe("2");
  });

  it("rejects a malformed body, a missing or mismatched type header, and an oversized body", async () => {
    const dependencies = { fetchCertificate: vi.fn(), now: () => now };
    await expect(verifySnsRequest("not json", headersFor("Notification"), syntheticSnsEnvironment, dependencies)).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verifySnsRequest("[]", headersFor("Notification"), syntheticSnsEnvironment, dependencies)).rejects.toBeInstanceOf(SnsVerificationError);
    const envelope = signedSnsEnvelope(certificate.privateKey, {});
    await expect(verifySnsRequest(JSON.stringify(envelope), new Headers(), syntheticSnsEnvironment, dependencies)).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verifySnsRequest(JSON.stringify(envelope), headersFor("SubscriptionConfirmation"), syntheticSnsEnvironment, dependencies)).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verifySnsRequest("x".repeat(256 * 1024 + 1), headersFor("Notification"), syntheticSnsEnvironment, dependencies)).rejects.toMatchObject({ status: 413 });
    expect(dependencies.fetchCertificate).not.toHaveBeenCalled();
  });

  it("never fetches a certificate from an address outside sns.<region>.amazonaws.com", async () => {
    const bad = [
      "http://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://sns.us-west-2.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://evil.example.test/SimpleNotificationService-abc.pem",
      "https://sns.us-east-2.amazonaws.com.evil.example.test/SimpleNotificationService-abc.pem",
      "https://sns.us-east-2.amazonaws.com@evil.example.test/SimpleNotificationService-abc.pem",
      "https://user:pass@sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://sns.us-east-2.amazonaws.com:8443/SimpleNotificationService-abc.pem",
      "https://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem?x=1",
      "https://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem#frag",
      "https://sns.us-east-2.amazonaws.com/../etc/passwd.pem",
      "https://sns.us-east-2.amazonaws.com/other.pem",
      "https://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.crt",
      "https://sns.cn-north-1.amazonaws.com.cn/SimpleNotificationService-abc.pem",
      "//sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem",
      "",
    ];
    for (const url of bad) {
      expect(parseSigningCertUrl(url, SYNTHETIC_REGION), url).toBeNull();
      const envelope = signedSnsEnvelope(certificate.privateKey, { certUrl: url || "x" });
      const { promise, fetchCertificate } = verify(envelope);
      await expect(promise).rejects.toBeInstanceOf(SnsVerificationError);
      expect(fetchCertificate).not.toHaveBeenCalled();
    }
    expect(parseSigningCertUrl(SYNTHETIC_CERT_URL, SYNTHETIC_REGION)?.toString()).toBe(SYNTHETIC_CERT_URL);
  });

  it("surfaces an unreachable certificate host as retryable, not as an invalid message", async () => {
    const envelope = signedSnsEnvelope(certificate.privateKey, {});
    const promise = verifySnsRequest(JSON.stringify(envelope), headersFor("Notification"), syntheticSnsEnvironment, {
      fetchCertificate: async () => { throw new SnsUnavailableError("down"); },
      now: () => now,
    });
    await expect(promise).rejects.toBeInstanceOf(SnsUnavailableError);
  });
});

describe("subscription confirmation is narrow (#863)", () => {
  const token = "synthetic-token-0001";
  const config = { topicArn: SYNTHETIC_TOPIC_ARN, accountId: SYNTHETIC_ACCOUNT, region: SYNTHETIC_REGION, minSignatureVersion: "1" as const };
  const good = `https://sns.${SYNTHETIC_REGION}.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(SYNTHETIC_TOPIC_ARN)}&Token=${token}`;

  it("accepts only the SNS host root with this topic and this token and nothing else", () => {
    expect(parseSubscribeUrl(good, config, token)?.toString()).toBe(good);
    const bad = [
      good.replace("https://sns.us-east-2.amazonaws.com/", "https://evil.example.test/"),
      good.replace("https://", "http://"),
      good.replace("amazonaws.com/?", "amazonaws.com/other?"),
      good.replace("Action=ConfirmSubscription", "Action=Publish"),
      good.replace(encodeURIComponent(SYNTHETIC_TOPIC_ARN), encodeURIComponent("arn:aws:sns:us-east-2:123456789012:other")),
      good.replace(`Token=${token}`, "Token=other"),
      `${good}&Extra=1`,
      `${good}&Token=${token}`,
      `${good}#x`,
      good.replace("sns.us-east-2", "sns.us-east-2:444"),
    ];
    for (const url of bad) expect(parseSubscribeUrl(url, config, token), url).toBeNull();
    expect(parseSubscribeUrl(good, config, "")).toBeNull();
  });

  it("makes exactly one GET, with redirects refused, to the validated address", async () => {
    const envelope = signedSnsEnvelope(certificate.privateKey, { type: "SubscriptionConfirmation", token });
    const verified = await verify(envelope).promise;
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
    await confirmSnsSubscription(verified, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { redirect: string }];
    expect(url).toBe(envelope.SubscribeURL);
    expect(init.redirect).toBe("error");
  });

  it("refuses a signed confirmation whose SubscribeURL points elsewhere, without fetching", async () => {
    const envelope = signedSnsEnvelope(certificate.privateKey, {
      type: "SubscriptionConfirmation",
      token,
      subscribeUrl: `https://evil.example.test/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(SYNTHETIC_TOPIC_ARN)}&Token=${token}`,
    });
    const verified = await verify(envelope).promise;
    const fetchImpl = vi.fn();
    await expect(confirmSnsSubscription(verified, fetchImpl)).rejects.toBeInstanceOf(SnsVerificationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("releases the confirmation response without reading it", async () => {
    const verified = await verify(signedSnsEnvelope(certificate.privateKey, { type: "SubscriptionConfirmation", token })).promise;
    const cancel = vi.fn(async () => undefined);
    const text = vi.fn(async () => "");
    await confirmSnsSubscription(verified, async () => ({ ok: true, status: 200, text, body: { cancel } }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it("treats a failed confirmation request as retryable", async () => {
    const verified = await verify(signedSnsEnvelope(certificate.privateKey, { type: "SubscriptionConfirmation", token })).promise;
    await expect(confirmSnsSubscription(verified, async () => { throw new Error("network"); })).rejects.toBeInstanceOf(SnsUnavailableError);
    await expect(confirmSnsSubscription(verified, async () => ({ ok: false, status: 500, text: async () => "" }))).rejects.toBeInstanceOf(SnsUnavailableError);
  });

  it("never confirms from a Notification", async () => {
    const verified = await verify(signedSnsEnvelope(certificate.privateKey, {})).promise;
    const fetchImpl = vi.fn();
    await expect(confirmSnsSubscription(verified, fetchImpl)).rejects.toBeInstanceOf(SnsVerificationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("SES notifications inside SNS (#863)", () => {
  const config = { topicArn: SYNTHETIC_TOPIC_ARN, accountId: SYNTHETIC_ACCOUNT, region: SYNTHETIC_REGION, minSignatureVersion: "1" as const };
  const envelopeFor = (message: string) => ({ Message: message, Timestamp: "2026-10-23T12:00:30.000Z" }) as SnsEnvelope;

  it("reads a permanent bounce as a hard bounce that suppresses the reported addresses, normalized", () => {
    for (const format of ["identity", "event"] as const) {
      const feedback = parseSesNotification(envelopeFor(sesNotificationMessage({ type: "Bounce", format, recipients: ["  Bounced.Person@Example.TEST ", "second@example.test"] })), config)!;
      expect(feedback.kind).toBe("HARD_BOUNCE");
      expect(feedback.eventType).toBe("ses.bounce.permanent");
      expect(feedback.suppressRecipients).toEqual(["bounced.person@example.test", "second@example.test"]);
      expect(feedback.providerMessageId).toBe("0100synthetic-ses-message-id-000001");
      expect(feedback.occurredAt.toISOString()).toBe("2026-10-23T12:00:00.000Z");
    }
  });

  it("records a transient or undetermined bounce without suppressing anyone", () => {
    for (const bounceType of ["Transient", "Undetermined"]) {
      const feedback = parseSesNotification(envelopeFor(sesNotificationMessage({ type: "Bounce", bounceType, bounceSubType: "MailboxFull" })), config)!;
      expect(feedback.kind).toBe("SOFT_BOUNCE");
      expect(feedback.suppressRecipients).toEqual([]);
    }
  });

  it("reads a complaint as suppressing, and a delivery as suppressing no one", () => {
    const complaint = parseSesNotification(envelopeFor(sesNotificationMessage({ type: "Complaint", recipients: ["spam.reporter@example.test"] })), config)!;
    expect(complaint.kind).toBe("COMPLAINT");
    expect(complaint.suppressRecipients).toEqual(["spam.reporter@example.test"]);
    const delivery = parseSesNotification(envelopeFor(sesNotificationMessage({ type: "Delivery" })), config)!;
    expect(delivery.kind).toBe("DELIVERY");
    expect(delivery.suppressRecipients).toEqual([]);
  });

  it("ignores events it does not act on and refuses a bad or foreign one", () => {
    expect(parseSesNotification(envelopeFor(JSON.stringify({ eventType: "Send", mail: {} })), config)).toBeNull();
    expect(parseSesNotification(envelopeFor(JSON.stringify({ notificationType: "AmazonSnsSubscriptionSucceeded", message: "ok" })), config)).toBeNull();
    expect(() => parseSesNotification(envelopeFor("not json"), config)).toThrow(SnsVerificationError);
    expect(() => parseSesNotification(envelopeFor(JSON.stringify({ notificationType: "Bounce", mail: { messageId: "x" } })), config)).toThrow(SnsVerificationError);
    expect(() => parseSesNotification(envelopeFor(sesNotificationMessage({ type: "Bounce", accountId: "999999999999" })), config)).toThrow(/not allowed/);
    expect(() => parseSesNotification(envelopeFor(sesNotificationMessage({ type: "Bounce", messageId: "has spaces and ../" })), config)).toThrow(SnsVerificationError);
  });

  it("falls back to the SNS timestamp when the event has none, and skips addresses that are not addresses", () => {
    const body = JSON.parse(sesNotificationMessage({ type: "Bounce", recipients: ["not-an-address", "ok@example.test"] }));
    delete body.bounce.timestamp;
    delete body.mail.timestamp;
    const feedback = parseSesNotification(envelopeFor(JSON.stringify(body)), config)!;
    expect(feedback.occurredAt.toISOString()).toBe("2026-10-23T12:00:30.000Z");
    expect(feedback.suppressRecipients).toEqual(["ok@example.test"]);
  });
});

describe("provider message id normalization (#863)", () => {
  it("the id the adapter records from the SMTP reply is the id SES reports as mail.messageId", () => {
    const sesId = "0100018f2c1d7a3b-4d6e8f10-1a2b-4c3d-8e9f-0a1b2c3d4e5f-000000";
    const recorded = messageIdFromResponse(`250 Ok ${sesId}`);
    expect(recorded).toBe(sesId);
    const feedback = parseSesNotification(
      { Message: sesNotificationMessage({ type: "Delivery", messageId: sesId }), Timestamp: "2026-10-23T12:00:00Z" } as SnsEnvelope,
      { topicArn: SYNTHETIC_TOPIC_ARN, accountId: SYNTHETIC_ACCOUNT, region: SYNTHETIC_REGION, minSignatureVersion: "1" },
    )!;
    expect(feedback.providerMessageId).toBe(recorded);
  });

  it("never falls back to the Message-ID this app generated, and normalizes what SES returned", () => {
    expect(messageIdFromResponse("250 Ok <abc-123@email.amazonses.com>")).toBe("abc-123");
    expect(messageIdFromResponse("250 Ok")).toBeNull();
    expect(messageIdFromResponse("250 2.0.0 Ok: queued as XYZ")).toBeNull();
    expect(messageIdFromResponse(undefined)).toBeNull();
  });

  it("also reads the Message-ID header form and refuses anything that is not a plain id", () => {
    expect(normalizeSesMessageId("<abc-123@email.amazonses.com>")).toBe("abc-123");
    expect(normalizeSesMessageId("  abc-123  ")).toBe("abc-123");
    expect(normalizeSesMessageId("abc@evil.example.test")).toBeNull();
    expect(normalizeSesMessageId("")).toBeNull();
    expect(normalizeSesMessageId(null)).toBeNull();
    expect(normalizeSesMessageId("a b")).toBeNull();
  });
});

describe("Email health reports whether SES reports come back (#863)", () => {
  it("is configured only when both the topic and the account are set", () => {
    const base = { SES_REGION: "us-east-2", SES_SMTP_USERNAME: "u", SES_SMTP_PASSWORD: "p" };
    const saved = { ...process.env };
    try {
      for (const key of ["SES_SNS_TOPIC_ARN", "SES_AWS_ACCOUNT_ID"]) delete process.env[key];
      Object.assign(process.env, base);
      expect(getSesEmailAvailability()).toEqual({ deliveryConfigured: true, webhookConfigured: false });
      process.env.SES_SNS_TOPIC_ARN = SYNTHETIC_TOPIC_ARN;
      expect(getSesEmailAvailability().webhookConfigured).toBe(false);
      process.env.SES_AWS_ACCOUNT_ID = SYNTHETIC_ACCOUNT;
      expect(getSesEmailAvailability().webhookConfigured).toBe(true);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});

describe("stricter verification (#863 review)", () => {
  const envAt = (timestamp: string) => signedSnsEnvelope(certificate.privateKey, { timestamp });

  it("requires the signing certificate path to be exactly SimpleNotificationService-<32 hex>.pem", () => {
    const base = `https://sns.${SYNTHETIC_REGION}.amazonaws.com/SimpleNotificationService-`;
    expect(parseSigningCertUrl(`${base}${"a".repeat(32)}.pem`, SYNTHETIC_REGION)).not.toBeNull();
    for (const bad of ["a".repeat(31), "a".repeat(33), "A".repeat(32), "g".repeat(32), "abc"]) {
      expect(parseSigningCertUrl(`${base}${bad}.pem`, SYNTHETIC_REGION), bad).toBeNull();
    }
  });

  it("requires a certificate for sns.amazonaws.com issued by Amazon", async () => {
    const wrongSubject = createSyntheticCertificate({ notBefore: new Date("2026-01-01T00:00:00Z"), notAfter: new Date("2027-01-01T00:00:00Z"), subject: "evil.example.test" });
    await expect(verify(signedSnsEnvelope(wrongSubject.privateKey, {}), { pem: wrongSubject.pem }).promise).rejects.toThrow(/Amazon SNS certificate/);
    const wrongIssuer = createSyntheticCertificate({ notBefore: new Date("2026-01-01T00:00:00Z"), notAfter: new Date("2027-01-01T00:00:00Z"), issuer: "Some Other CA" });
    await expect(verify(signedSnsEnvelope(wrongIssuer.privateKey, {}), { pem: wrongIssuer.pem }).promise).rejects.toThrow(/Amazon SNS certificate/);
  });

  it("refuses SignatureVersion 1 when SES_SNS_SIGNATURE_VERSION is 2, and accepts both by default", async () => {
    const strict = { ...syntheticSnsEnvironment, SES_SNS_SIGNATURE_VERSION: "2" };
    const v1 = signedSnsEnvelope(certificate.privateKey, { version: "1" });
    const v2 = signedSnsEnvelope(certificate.privateKey, { version: "2" });
    const refused = verify(v1, { env: strict });
    await expect(refused.promise).rejects.toBeInstanceOf(SnsVerificationError);
    expect(refused.fetchCertificate).not.toHaveBeenCalled();
    await expect(verify(v2, { env: strict }).promise).resolves.toBeTruthy();
    await expect(verify(v1).promise).resolves.toBeTruthy();
  });

  it("refuses an envelope more than 7 days old or more than 5 minutes in the future, and an unreadable timestamp", async () => {
    // now = 2026-10-23T12:05:00Z
    await expect(verify(envAt("2026-10-16T12:06:00Z")).promise).resolves.toBeTruthy(); // just under 7 days
    await expect(verify(envAt("2026-10-16T12:04:00Z")).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify(envAt("2026-10-23T12:09:00Z")).promise).resolves.toBeTruthy(); // 4 minutes ahead
    await expect(verify(envAt("2026-10-23T12:11:00Z")).promise).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verify(envAt("yesterday")).promise).rejects.toBeInstanceOf(SnsVerificationError);
    const stale = verify(envAt("2026-10-01T00:00:00Z"));
    await expect(stale.promise).rejects.toBeInstanceOf(SnsVerificationError);
    expect(stale.fetchCertificate).not.toHaveBeenCalled();
  });
});

describe("reading the body with a cap (#863 review)", () => {
  const streamOf = (chunks: Uint8Array[], onCancel?: () => void) => {
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]!);
        else controller.close();
      },
      cancel() { onCancel?.(); },
    });
  };
  const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("https://events.imsda.test/x", { method: "POST", headers, body, duplex: "half" } as RequestInit);

  it("reads a normal body, multi-byte characters across chunks included", async () => {
    const bytes = new TextEncoder().encode('{"a":"é€"}');
    expect(await readSnsBody(req(streamOf([bytes.slice(0, 7), bytes.slice(7)])))).toBe('{"a":"é€"}');
    expect(await readSnsBody(req(null))).toBe("");
  });

  it("refuses a declared length above the cap before reading, and a bad one", async () => {
    const oversized = req(streamOf([new Uint8Array(10)]), { "content-length": String(SNS_MAX_BODY_BYTES + 1) });
    await expect(readSnsBody(oversized)).rejects.toMatchObject({ status: 413 });
    // Never even opened a reader on the stream.
    expect(oversized.body?.locked).toBe(false);
    await expect(readSnsBody(req("{}", { "content-length": "-5" }))).rejects.toMatchObject({ status: 400 });
    await expect(readSnsBody(req("{}", { "content-length": "abc" }))).rejects.toMatchObject({ status: 400 });
  });

  it("aborts a stream that exceeds the cap and cancels it", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(100).fill(97);
    await expect(readSnsBody(req(streamOf([chunk, chunk, chunk], () => { cancelled = true; })), 250)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});

describe("fetching the signing certificate (#863 review)", () => {
  const fetchMock = vi.fn();
  const urlN = (n: number) => `https://sns.${SYNTHETIC_REGION}.amazonaws.com/SimpleNotificationService-${n.toString(16).padStart(32, "0")}.pem`;
  const run = (n: number) => verifySnsRequest(
    JSON.stringify(signedSnsEnvelope(certificate.privateKey, { certUrl: urlN(n) })),
    headersFor("Notification"),
    syntheticSnsEnvironment,
    { now: () => now },
  );

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetSnsCertificateCache();
    fetchMock.mockReset();
  });
  const stub = () => { resetSnsCertificateCache(); vi.stubGlobal("fetch", fetchMock); };

  it("treats a 4xx from AWS as an invalid message and remembers the failure for five minutes", async () => {
    stub();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    fetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    await expect(run(1)).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(run(1)).rejects.toBeInstanceOf(SnsVerificationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(now.getTime() + 5 * 60 * 1000 + 1000));
    await expect(run(1)).rejects.toBeInstanceOf(SnsVerificationError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a 5xx or a network failure as retryable and also remembers it briefly", async () => {
    stub();
    fetchMock.mockImplementation(async () => new Response("", { status: 503 }));
    await expect(run(2)).rejects.toBeInstanceOf(SnsUnavailableError);
    await expect(run(2)).rejects.toBeInstanceOf(SnsUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => { throw new Error("network down"); });
    await expect(run(3)).rejects.toBeInstanceOf(SnsUnavailableError);
  });

  it("shares one in-flight request per URL, and caches a good certificate", async () => {
    stub();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async () => { await gate; return new Response(certificate.pem, { status: 200 }); });
    const concurrent = Array.from({ length: 6 }, () => run(4));
    release();
    await Promise.all(concurrent);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await run(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest cached certificate, never clearing the rest", async () => {
    stub();
    fetchMock.mockImplementation(async () => new Response(certificate.pem, { status: 200 }));
    for (let n = 10; n < 19; n += 1) await run(n); // nine distinct URLs, a cache of eight
    expect(fetchMock).toHaveBeenCalledTimes(9);
    await run(18);
    await run(11);
    expect(fetchMock).toHaveBeenCalledTimes(9); // the newest and the second oldest are still cached
    await run(10);
    expect(fetchMock).toHaveBeenCalledTimes(10); // only the oldest was evicted
  });
});
