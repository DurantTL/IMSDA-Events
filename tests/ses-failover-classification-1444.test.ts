import net from "node:net";
import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDataSentTracker, mapSesError, sendEmailWithSes, type SesEmailConfiguration } from "@/integrations/email/ses";
import { EmailProviderConfigurationError, EmailProviderRequestError } from "@/integrations/email/types";

/**
 * #1444: which Amazon SES failures mean "SES definitely did not accept this message", so the backup may take over.
 * Synthetic data only; the only network is a stub SMTP server on localhost.
 */

function smtp(responseCode: number | undefined, response: string, code?: string, command?: string) {
  return Object.assign(new Error(response), { responseCode, response, code, command });
}

const configuration: SesEmailConfiguration = {
  smtpHost: "127.0.0.1",
  smtpPort: 2587,
  username: "synthetic-smtp-user",
  password: "synthetic-smtp-password",
  region: "us-east-2",
  configurationSet: null,
  maxSendRate: 1000,
};
const input = {
  fromName: "IMSDA Events",
  fromEmail: "registration@imsda.org",
  toEmail: "attendee@example.test",
  subject: "Registration received",
  bodyText: "Your registration is saved.",
  idempotencyKey: "outbox:message-1",
  messageId: "message-1",
};

function asRequest(error: unknown) {
  expect(error).toBeInstanceOf(EmailProviderRequestError);
  return error as EmailProviderRequestError;
}

describe("mapSesError marks only definite refusals as not accepted", () => {
  it.each([
    ["throttling (454)", smtp(454, "454 Throttling failure: Maximum sending rate exceeded."), "PROVIDER_RATE_LIMITED"],
    ["daily quota", smtp(454, "454 Throttling failure: Daily message quota exceeded."), "PROVIDER_QUOTA"],
    ["another 4xx reply", smtp(421, "421 Service not available"), "SMTP_421"],
    ["a 5xx reply", smtp(550, "550 Mailbox unavailable", "EENVELOPE", "RCPT TO"), "SMTP_550"],
    ["a 554 rejection after the data", smtp(554, "554 Transaction failed", "EMESSAGE", "DATA"), "SES_MESSAGE_REJECTED"],
    ["an identity that is not verified", smtp(554, "554 Message rejected: Email address is not verified.", "EENVELOPE", "MAIL FROM"), "SES_IDENTITY_NOT_VERIFIED"],
    ["a temporary 4xx during login", smtp(454, "454 4.7.0 Temporary authentication failure", "EAUTH", "AUTH PLAIN"), "SES_AUTH_TEMPORARY"],
  ])("%s: not accepted, whatever the data had done", (_name, error, code) => {
    for (const dataSent of [false, true]) {
      const mapped = asRequest(mapSesError(error, { dataSent }));
      expect(mapped.code).toBe(code);
      expect(mapped.notAccepted).toBe(true);
    }
  });

  it("a refused connection, DNS, TLS or greeting fault before the data is not accepted", () => {
    for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ETLS", "EDNS", "EPROTOCOL", "ECONNREFUSED", "ENOTFOUND"]) {
      const mapped = asRequest(mapSesError(smtp(undefined, "boom", code, "CONN"), { dataSent: false }));
      expect(mapped).toMatchObject({ code: "NETWORK_ERROR", retryable: true, notAccepted: true });
    }
  });

  it("a timeout or socket drop AFTER the data was sent is ambiguous and never eligible", () => {
    for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET", "ERR_STREAM_PREMATURE_CLOSE"]) {
      for (const context of [{ dataSent: true }, {}]) {
        const mapped = asRequest(mapSesError(smtp(undefined, "boom", code, "CONN"), context));
        expect(mapped).toMatchObject({ code: "NETWORK_ERROR", retryable: true, notAccepted: false });
      }
    }
  });

  it("a local attachment stream fault is ours, not an outage", () => {
    expect(asRequest(mapSesError(smtp(undefined, "boom", "ESTREAM", "API"), { dataSent: false })).notAccepted).toBe(false);
  });

  it("per-message faults and unknown errors never fail over", () => {
    expect(asRequest(mapSesError(smtp(undefined, "Invalid recipient", "EENVELOPE", "API"), { dataSent: false })).notAccepted).toBe(false);
    expect(asRequest(mapSesError(smtp(undefined, "Empty message", "EMESSAGE", "API"), { dataSent: false })).notAccepted).toBe(false);
    expect(asRequest(mapSesError(new Error("surprise"), { dataSent: false })).notAccepted).toBe(false);
  });

  it("bad credentials stay a batch-wide configuration error (which the delivery worker may fail over on)", () => {
    const mapped = mapSesError(smtp(535, "535 Authentication Credentials Invalid", "EAUTH", "AUTH PLAIN"));
    expect(mapped).toBeInstanceOf(EmailProviderConfigurationError);
    expect((mapped as EmailProviderConfigurationError).batchWide).toBe(true);
  });

  it("an invalid recipient is thrown before SES is called and is not a refusal", async () => {
    const transport = { sendMail: vi.fn() };
    const error = await sendEmailWithSes({ ...input, toEmail: "not-an-address" }, configuration, { transport, pace: async () => undefined }).catch((caught) => caught);
    expect(asRequest(error)).toMatchObject({ code: "INVALID_ADDRESS", notAccepted: false });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it("sendEmailWithSes passes what the sender knows about the data", async () => {
    const failing = { sendMail: vi.fn(async () => { throw smtp(undefined, "Timeout", "ETIMEDOUT", "CONN"); }) };
    const pace = async () => undefined;
    const before = await sendEmailWithSes(input, configuration, { transport: failing, pace, dataSent: () => false }).catch((caught) => caught);
    const after = await sendEmailWithSes(input, configuration, { transport: failing, pace, dataSent: () => true }).catch((caught) => caught);
    const unknown = await sendEmailWithSes(input, configuration, { transport: failing, pace }).catch((caught) => caught);
    expect(asRequest(before).notAccepted).toBe(true);
    expect(asRequest(after).notAccepted).toBe(false);
    expect(asRequest(unknown).notAccepted).toBe(false);
  });
});

/**
 * nodemailer's own `err.command` is "CONN" for every socket fault, before or after DATA, so the adapter watches the
 * transport's log instead. These tests drive the real nodemailer against a stub server that drops the connection at
 * a chosen point.
 */
function stubServer(dropAt: "after-greeting" | "after-data") {
  const server = net.createServer((socket) => {
    socket.write("220 stub ESMTP\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("binary");
      if (dropAt === "after-greeting" && /EHLO|HELO/i.test(buffer)) {
        socket.destroy();
        return;
      }
      if (inData) {
        if (buffer.includes("\r\n.\r\n")) {
          // The whole message has arrived: drop without ever answering with a 250.
          socket.destroy();
        }
        return;
      }
      for (const line of buffer.split("\r\n").slice(0, -1)) {
        if (/^EHLO/i.test(line)) socket.write("250 stub\r\n");
        else if (/^MAIL FROM/i.test(line) || /^RCPT TO/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) { socket.write("354 go\r\n"); inData = true; buffer = ""; }
      }
      if (!inData) buffer = "";
    });
  });
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() });
    });
  });
}

async function sendThroughStub(dropAt: "after-greeting" | "after-data") {
  const stub = await stubServer(dropAt);
  const tracker = createDataSentTracker();
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: stub.port,
    secure: false,
    ignoreTLS: true,
    logger: tracker.logger,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 3000,
  });
  try {
    await transport.sendMail({ from: "registration@imsda.org", to: "attendee@example.test", subject: "Test", text: "Hello" });
    throw new Error("the stub should have dropped the connection");
  } catch (error) {
    return mapSesError(error, { dataSent: tracker.state.dataSent });
  } finally {
    transport.close();
    stub.close();
  }
}

describe("the data-sent signal from the real nodemailer", () => {
  it("a connection dropped before the message data is not accepted", async () => {
    expect(asRequest(await sendThroughStub("after-greeting"))).toMatchObject({ code: "NETWORK_ERROR", notAccepted: true });
  });

  it("a connection dropped after the whole message was written is ambiguous", async () => {
    expect(asRequest(await sendThroughStub("after-data"))).toMatchObject({ code: "NETWORK_ERROR", notAccepted: false });
  });
});
