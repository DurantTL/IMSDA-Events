/**
 * The "dev outbox" for the role journeys (#1439): a tiny stand-in for Resend that runs inside the suite process.
 *
 * Why it exists: in production mode the app never returns a sign-in code in a response (`developmentCode` is only for
 * non-production, see modules/attendee-accounts/sign-in-code-issue.ts). A person reads the code in their inbox, so the
 * journeys read it from the message the app "sent". The app talks to Resend with `fetch(`${RESEND_API_URL}/emails`)`
 * (integrations/email/resend.ts), so pointing RESEND_API_URL here captures every message and nothing leaves the machine.
 *
 * Start the app under test with:
 *   RESEND_API_KEY=ci-placeholder-never-sent
 *   RESEND_API_URL=http://127.0.0.1:3999      (JOURNEY_MAIL_PORT, default 3999)
 *   ACCOUNT_EMAIL_SENDER_ADDRESS=events@ci.example.test
 *
 * Messages leave the app two ways, and both end at the URL above: account email (sign-in codes, verification) is
 * delivered right after the response (`after()`), and queued event/club mail (invites) is delivered by the outbox
 * sweep. `waitForMessage` therefore nudges the sweep once, with OUTBOX_SWEEP_TOKEN, when nothing has arrived after a
 * few seconds (the sweep is what the scheduler does in production; a missing or wrong token only skips the nudge).
 */
import { createServer, type Server } from "node:http";

export type CapturedMessage = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  text: string;
  html: string;
  receivedAt: number;
};

export type Matcher = RegExp | ((message: CapturedMessage) => boolean);

const defaultSweepToken = "ci-only-outbox-sweep-token-000000000000";

export class FakeMailServer {
  readonly port: number;
  readonly messages: CapturedMessage[] = [];
  private server: Server | null = null;
  private sequence = 0;
  private readonly runId = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  private sweepNudged = new Set<string>();

  constructor(port = Number(process.env.JOURNEY_MAIL_PORT ?? 3999), private readonly appUrl = (process.env.JOURNEY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")) {
    this.port = port;
  }

  async start() {
    this.server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        // Resend's POST /emails answers { id }; anything else is a 404 so a wrong path shows up in the app log.
        if (request.method !== "POST" || !/^\/emails\/?$/.test(request.url ?? "")) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "not found" }));
          return;
        }
        let parsed: { from?: string; to?: string[] | string; subject?: string; text?: string; html?: string } = {};
        try { parsed = JSON.parse(body || "{}"); } catch { /* an empty message is still recorded */ }
        // Unique per run: the app stores this as the message's provider id, which must not repeat across runs on one database.
        const id = `journey-mail-${this.runId}-${++this.sequence}`;
        this.messages.push({
          id, from: parsed.from ?? "", to: (Array.isArray(parsed.to) ? parsed.to : [parsed.to ?? ""]).map((address) => address.toLowerCase()),
          subject: parsed.subject ?? "", text: parsed.text ?? "", html: parsed.html ?? "", receivedAt: Date.now(),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", (error: NodeJS.ErrnoException) => {
        reject(error.code === "EADDRINUSE" ? new Error(`Port ${this.port} is in use. Set JOURNEY_MAIL_PORT, and start the app with the same RESEND_API_URL.`) : error);
      });
      this.server!.listen(this.port, "127.0.0.1", resolve);
    });
  }

  async stop() {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  }

  /** Messages to an address (case-insensitive), oldest first. */
  to(address: string) {
    const wanted = address.toLowerCase();
    return this.messages.filter((message) => message.to.includes(wanted));
  }

  /** Asks the app to deliver anything still queued (what the scheduler does). Best effort. */
  private async nudgeSweep(key: string) {
    if (this.sweepNudged.has(key)) return;
    this.sweepNudged.add(key);
    // OUTBOX_SWEEP_TOKEN from the environment, then the CI value: a local .env can carry a different token than the apps under test.
    const tokens = [...new Set([process.env.OUTBOX_SWEEP_TOKEN, defaultSweepToken].filter((value): value is string => Boolean(value)))];
    for (const token of tokens) {
      try {
        const response = await fetch(`${this.appUrl}/api/internal/outbox/sweep`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
        if (response.status !== 401 && response.status !== 403) return;
      } catch {
        // The sweep is busy: the wait continues.
        return;
      }
    }
  }

  /**
   * The newest message to `to` that matches and arrived at or after `since` (required, ms since the epoch), waiting up to `timeoutMs`.
   * Polls on a short condition loop, no fixed sleep.
   */
  async waitForMessage(to: string, matcher: Matcher, options: { since: number; timeoutMs?: number }): Promise<CapturedMessage> {
    const since = options.since;
    const timeoutMs = options.timeoutMs ?? 45_000;
    const test = typeof matcher === "function" ? matcher : (message: CapturedMessage) => matcher.test(`${message.subject}\n${message.text}`);
    const started = Date.now();
    const key = `${to}:${started}`;
    for (;;) {
      // The newest match, so a resent code or invite wins over the one it replaced.
      const found = this.to(to).filter((message) => message.receivedAt >= since && test(message)).at(-1);
      if (found) return found;
      const waited = Date.now() - started;
      if (waited > 6_000) await this.nudgeSweep(key);
      if (waited > timeoutMs) {
        const seen = this.to(to).map((message) => `"${message.subject}"`).join(", ") || "none";
        throw new Error(`No matching email to ${to} within ${Math.round(timeoutMs / 1000)}s (messages to that address: ${seen}).`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /** The newest six-digit sign-in code emailed to `to` after `since`. */
  async waitForCode(to: string, options: { since: number; timeoutMs?: number }): Promise<string> {
    // The email shows the code in two groups ("805 205"); a password manager would copy it either way.
    const pattern = /\b(\d{3}) ?(\d{3})\b/;
    const message = await this.waitForMessage(to, (candidate) => /code/i.test(candidate.subject) && pattern.test(candidate.text), options);
    const code = pattern.exec(message.text);
    if (!code) throw new Error(`The message "${message.subject}" has no six-digit code.`);
    return `${code[1]}${code[2]}`;
  }

  /** Like `waitForCode`, for the message whose subject matches (sign-up verification, security code, edit code). */
  async waitForCodeWithSubject(to: string, subject: RegExp, options: { since: number; timeoutMs?: number }): Promise<string> {
    const pattern = /\b(\d{3}) ?(\d{3})\b/;
    const message = await this.waitForMessage(to, (candidate) => subject.test(candidate.subject) && pattern.test(candidate.text), options);
    const code = pattern.exec(message.text);
    if (!code) throw new Error(`The message "${message.subject}" has no six-digit code.`);
    return `${code[1]}${code[2]}`;
  }

  /**
   * Local-only proof that the app under test really sends its email here, so a suite never waits on mail that went nowhere (or, worse,
   * to a real mailbox): asks the app for one emailed security code for a made-up address and requires it to arrive in this outbox.
   */
  async assertAppMailReachesOutbox(appUrl: string = this.appUrl) {
    const address = `journeyevt.mailprobe.${Date.now().toString(36)}@example.test`;
    const since = Date.now() - 1_000;
    const fix = `Start the app under test with RESEND_API_KEY=ci-placeholder-never-sent RESEND_API_URL=http://127.0.0.1:${this.port} ACCOUNT_EMAIL_SENDER_ADDRESS=events@ci.example.test (and JOURNEY_MAIL_PORT=${this.port} here), as the header of the suite says.`;
    let status = 0;
    try {
      const response = await fetch(`${appUrl}/api/security-check/email-code`, {
        method: "POST", headers: { "content-type": "application/json", origin: appUrl },
        body: JSON.stringify({ action: "attendee-sign-up", email: address, website: "" }), signal: AbortSignal.timeout(30_000),
      });
      status = response.status;
    } catch (error) {
      throw new Error(`The app at ${appUrl} did not answer the mail check (${(error as Error).message}). Is it running?`);
    }
    if (status !== 202) throw new Error(`The app at ${appUrl} refused the mail check with status ${status}. ${fix}`);
    try {
      await this.waitForMessage(address, /security code/i, { since, timeoutMs: 30_000 });
    } catch {
      throw new Error(`The app at ${appUrl} did not send its email to the dev outbox on port ${this.port}, so no sign-in or verification code could be read. ${fix}`);
    }
  }
}
