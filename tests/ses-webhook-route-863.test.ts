import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/modules/communications/ses-event-repository", () => ({ recordSesFeedbackEvent: mocks.record }));

import { POST } from "@/app/api/webhooks/ses/route";
import { resetSnsCertificateCache } from "@/integrations/email/ses-sns";
import {
  SYNTHETIC_CERT_URL,
  SYNTHETIC_TOPIC_ARN,
  createSyntheticCertificate,
  sesNotificationMessage,
  signedSnsEnvelope,
  syntheticSnsEnvironment,
  type SyntheticCertificate,
} from "./support/synthetic-sns";

let certificate: SyntheticCertificate;
beforeAll(() => {
  certificate = createSyntheticCertificate({ notBefore: new Date(Date.now() - 86_400_000), notAfter: new Date(Date.now() + 86_400_000) });
});

const fetchMock = vi.fn();
const saved = { topic: process.env.SES_SNS_TOPIC_ARN, account: process.env.SES_AWS_ACCOUNT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  resetSnsCertificateCache();
  process.env.SES_SNS_TOPIC_ARN = syntheticSnsEnvironment.SES_SNS_TOPIC_ARN;
  process.env.SES_AWS_ACCOUNT_ID = syntheticSnsEnvironment.SES_AWS_ACCOUNT_ID;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === SYNTHETIC_CERT_URL) return new Response(certificate.pem, { status: 200 });
    return new Response("", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  mocks.record.mockResolvedValue({ duplicate: false, matchedMessageId: "msg_1", mappedStatus: "DELIVERED", suppressedCount: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (saved.topic === undefined) delete process.env.SES_SNS_TOPIC_ARN; else process.env.SES_SNS_TOPIC_ARN = saved.topic;
  if (saved.account === undefined) delete process.env.SES_AWS_ACCOUNT_ID; else process.env.SES_AWS_ACCOUNT_ID = saved.account;
});

function request(body: unknown, type = "Notification") {
  return new Request("https://events.imsda.test/api/webhooks/ses", {
    method: "POST",
    headers: { "x-amz-sns-message-type": type, "content-type": "text/plain; charset=UTF-8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Signed now, because the route checks the envelope's age against the real clock. */
const sign = (options: Parameters<typeof signedSnsEnvelope>[1] = {}) =>
  signedSnsEnvelope(certificate.privateKey, { timestamp: new Date().toISOString(), ...options });

const notification = (overrides: Parameters<typeof signedSnsEnvelope>[1] = {}) =>
  sign({ message: sesNotificationMessage({ type: "Delivery" }), ...overrides });

describe("POST /api/webhooks/ses (#863)", () => {
  it("records a verified delivery event keyed by the SNS MessageId", async () => {
    const response = await POST(request(notification({ messageId: "sns-message-1" })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, duplicate: false, matched: true });
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record.mock.calls[0]![0]).toBe("sns-message-1");
    expect(mocks.record.mock.calls[0]![1]).toMatchObject({ kind: "DELIVERY", providerMessageId: "0100synthetic-ses-message-id-000001" });
  });

  it("acknowledges a duplicate", async () => {
    mocks.record.mockResolvedValue({ duplicate: true, matchedMessageId: null, mappedStatus: null, suppressedCount: 0 });
    const response = await POST(request(notification()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true, matched: false });
  });

  it("acknowledges a notification it does not act on without storing it", async () => {
    const response = await POST(request(notification({ message: JSON.stringify({ eventType: "Send", mail: {} }) })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: true });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "this is not json", 400],
    ["a JSON array", "[]", 400],
    ["an unsigned envelope", { Type: "Notification", MessageId: "m", TopicArn: SYNTHETIC_TOPIC_ARN, Message: "{}", Timestamp: "2026-10-23T12:00:00Z" }, 400],
  ])("returns 4xx and stores nothing for %s", async (_name, body, status) => {
    const response = await POST(request(body));
    expect(response.status).toBe(status);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("returns 4xx for a tampered message, another topic, a foreign account and a bad certificate address, storing nothing", async () => {
    const signed = notification();
    expect((await POST(request({ ...signed, Message: sesNotificationMessage({ type: "Bounce" }) }))).status).toBe(400);
    expect((await POST(request(notification({ topicArn: "arn:aws:sns:us-east-2:123456789012:other-topic" })))).status).toBe(403);
    expect((await POST(request(notification({ message: sesNotificationMessage({ type: "Bounce", accountId: "999999999999" }) })))).status).toBe(403);
    expect((await POST(request(notification({ certUrl: "https://evil.example.test/SimpleNotificationService-abc.pem" })))).status).toBe(400);
    expect((await POST(request(signed, "SubscriptionConfirmation"))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
    // The evil certificate address was never fetched.
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain("https://evil.example.test/SimpleNotificationService-abc.pem");
  });

  it("refuses an oversized body with 413 from content-length alone, reading none of it", async () => {
    const response = await POST(new Request("https://events.imsda.test/api/webhooks/ses", {
      method: "POST",
      headers: { "x-amz-sns-message-type": "Notification", "content-length": String(256 * 1024 + 1) },
      body: "{}",
    }));
    expect(response.status).toBe(413);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuts off a body that streams past the cap, whatever it declared, with 413", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        if (pulled > 200) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(new Request("https://events.imsda.test/api/webhooks/ses", {
      method: "POST",
      headers: { "x-amz-sns-message-type": "Notification" },
      body: stream,
      duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    // Stopped soon after the cap (256 KB is four 64 KB chunks), not after draining the whole stream.
    expect(pulled).toBeLessThan(20);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("answers a broken upload with a clean 400", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() { throw new Error("connection reset"); } });
    const response = await POST(new Request("https://events.imsda.test/api/webhooks/ses", {
      method: "POST",
      headers: { "x-amz-sns-message-type": "Notification" },
      body: stream,
      duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("answers 4xx, not 503, when AWS says the signing certificate does not exist", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const response = await POST(request(notification()));
    expect(response.status).toBe(400);
  });

  it("returns 503 when the topic and account are not configured", async () => {
    delete process.env.SES_SNS_TOPIC_ARN;
    delete process.env.SES_AWS_ACCOUNT_ID;
    const response = await POST(request(notification()));
    expect(response.status).toBe(503);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("returns 503 so SNS retries when the signing certificate cannot be fetched", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const response = await POST(request(notification()));
    expect(response.status).toBe(503);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("returns 500 so SNS retries when storing fails", async () => {
    mocks.record.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request(notification()));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database unavailable");
  });

  it("confirms the subscription of the allowed topic with one request to its own SubscribeURL", async () => {
    const envelope = sign({ type: "SubscriptionConfirmation" });
    const response = await POST(request(envelope, "SubscriptionConfirmation"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ confirmed: true });
    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual([SYNTHETIC_CERT_URL, envelope.SubscribeURL]);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("refuses a signed confirmation that points anywhere else, and fetches nothing for it", async () => {
    const envelope = sign({
      type: "SubscriptionConfirmation",
      subscribeUrl: "https://evil.example.test/?Action=ConfirmSubscription",
    });
    const response = await POST(request(envelope, "SubscriptionConfirmation"));
    expect(response.status).toBe(400);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SYNTHETIC_CERT_URL]);
  });

  it("acknowledges an UnsubscribeConfirmation without following anything", async () => {
    const envelope = sign({ type: "UnsubscribeConfirmation" });
    const response = await POST(request(envelope, "UnsubscribeConfirmation"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SYNTHETIC_CERT_URL]);
  });
});
