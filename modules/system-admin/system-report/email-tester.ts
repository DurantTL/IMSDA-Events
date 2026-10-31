import "server-only";

import { z } from "zod";
import type { MessageOutboxStatus, MessageProviderDeliveryStatus } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { AccountEmailNotConfiguredError } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { enqueueSystemTestEmail, SYSTEM_TEST_EMAIL_TRIGGER } from "@/modules/communications/system-test-email";
import { checkSystemEmailTestRateLimit } from "@/modules/rate-limit/service";
import { nextAllowedAt } from "@/modules/system-admin/system-report/tester-limits";

/**
 * The System report's email tester (#1383). A system administrator types one address; one labelled test email goes
 * through the real outbox and the real delivery loop; the card then follows that one row to its result.
 *
 * What leaves this module is fixed words and times only: a state, a provider name, three times, and one fixed sentence.
 * Never a provider payload, a raw error, an address, or any other outbox row.
 */

/** After this long with no delivered, bounced or complained notice, the card says "No notice yet". */
export const EMAIL_NOTICE_WAIT_MS = 5 * 60 * 1000;

export const emailTestInputSchema = z.object({
  /** One address only: the standard email check rejects commas, spaces and lists. */
  to: z.string().trim().max(254).pipe(z.email()),
}).strict();

export type EmailTestState = "queued" | "waiting" | "delivered" | "bounced" | "complained" | "failed" | "suppressed" | "no-notice" | "unavailable";

export type EmailTestStatus = {
  testId: string;
  ref: string;
  state: EmailTestState;
  provider: "Resend" | "Amazon SES" | null;
  queuedAt: string;
  sentAt: string | null;
  outcomeAt: string | null;
  /** One of the fixed sentences below, or null. Never provider text. */
  reason: string | null;
  /** True when polling can stop: nothing more will change on its own. */
  final: boolean;
};

/** The only sentences a failure can carry. */
export const EMAIL_TEST_REASONS = {
  bounced: "The receiving server refused it.",
  complained: "The recipient marked it as spam.",
  failed: "The email provider could not send it.",
  unavailable: "The email provider did not confirm the send in time. It may still arrive.",
  "not-sent": "The email provider could not be reached or did not answer, so the test was not confirmed as sent.",
  suppressed: "This address is on the do-not-send list after an earlier bounce or spam report.",
  "no-notice": "The provider has not reported delivered or bounced yet.",
} as const;

export type EmailTestRow = {
  id: string;
  status: MessageOutboxStatus;
  createdAt: Date;
  sentAt: Date | null;
  provider: string | null;
  providerDeliveryStatus: MessageProviderDeliveryStatus | null;
  providerStatusAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  metadata: unknown;
};

export type EmailTestProviderEvent = {
  mappedDeliveryStatus: MessageProviderDeliveryStatus | null;
  occurredAt: Date;
};

export function emailTestRef(metadata: unknown) {
  const ref = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).testRef : null;
  return typeof ref === "string" && /^T-[A-Z0-9]{4}$/.test(ref) ? ref : "T-????";
}

const providerLabel: Record<string, EmailTestStatus["provider"]> = { RESEND: "Resend", SES: "Amazon SES" };

/** Worst notice wins: a bounce after a delivery still means the address cannot be trusted. */
const noticePrecedence: MessageProviderDeliveryStatus[] = ["COMPLAINED", "BOUNCED", "SUPPRESSED", "FAILED", "DELIVERED"];

function classifyNotice(row: EmailTestRow, events: readonly EmailTestProviderEvent[]) {
  const seen = new Map<MessageProviderDeliveryStatus, Date | null>();
  if (row.providerDeliveryStatus) {
    seen.set(row.providerDeliveryStatus, row.deliveredAt && row.providerDeliveryStatus === "DELIVERED" ? row.deliveredAt : row.providerStatusAt);
  }
  for (const event of events) {
    if (event.mappedDeliveryStatus && !seen.has(event.mappedDeliveryStatus)) seen.set(event.mappedDeliveryStatus, event.occurredAt);
  }
  for (const status of noticePrecedence) {
    if (seen.has(status)) return { status, at: seen.get(status) ?? null };
  }
  return null;
}

/** Pure: turns the stored outbox row and its provider notices into the card's state. */
export function mapEmailTestStatus(
  row: EmailTestRow,
  events: readonly EmailTestProviderEvent[],
  now: Date,
): EmailTestStatus {
  const base = {
    testId: row.id,
    ref: emailTestRef(row.metadata),
    provider: row.provider ? providerLabel[row.provider] ?? null : null,
    queuedAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
  const done = (
    state: Exclude<EmailTestState, "queued" | "waiting" | "no-notice" | "delivered">,
    at: Date | null,
    reason: string = EMAIL_TEST_REASONS[state],
  ): EmailTestStatus => ({
    ...base, state, outcomeAt: at?.toISOString() ?? null, reason, final: true,
  });

  if (row.status === "SUPPRESSED") return done("suppressed", row.failedAt ?? row.createdAt);
  // CANCELLED: the inline send claimed nothing or the provider did not answer, or the sweep closed an abandoned
  // test. Nothing confirms a send, so say exactly that rather than promising it may still arrive.
  if (row.status === "CANCELLED") return done("unavailable", row.failedAt ?? null, EMAIL_TEST_REASONS["not-sent"]);
  if (row.status === "FAILED") return done("failed", row.failedAt ?? null);
  if (row.status !== "SENT") {
    // Still held by a worker after the notice wait: stop promising a result.
    if (now.getTime() - row.createdAt.getTime() >= EMAIL_NOTICE_WAIT_MS) return done("unavailable", new Date(row.createdAt.getTime() + EMAIL_NOTICE_WAIT_MS));
    return { ...base, state: "queued", outcomeAt: null, reason: null, final: false };
  }
  const notice = classifyNotice(row, events);
  if (notice?.status === "DELIVERED") {
    return { ...base, state: "delivered", outcomeAt: (notice.at ?? row.deliveredAt)?.toISOString() ?? null, reason: null, final: true };
  }
  if (notice?.status === "COMPLAINED") return done("complained", notice.at);
  if (notice?.status === "BOUNCED") return done("bounced", notice.at);
  if (notice?.status === "SUPPRESSED") return done("suppressed", notice.at);
  if (notice?.status === "FAILED") return done("failed", notice.at ?? row.failedAt);

  const waitedMs = row.sentAt ? now.getTime() - row.sentAt.getTime() : 0;
  if (row.sentAt && waitedMs >= EMAIL_NOTICE_WAIT_MS) {
    return { ...base, state: "no-notice", outcomeAt: new Date(row.sentAt.getTime() + EMAIL_NOTICE_WAIT_MS).toISOString(), reason: EMAIL_TEST_REASONS["no-notice"], final: true };
  }
  return { ...base, state: "waiting", outcomeAt: null, reason: null, final: false };
}

const rowSelect = {
  id: true, status: true, createdAt: true, sentAt: true, provider: true, providerDeliveryStatus: true,
  providerStatusAt: true, deliveredAt: true, failedAt: true, metadata: true,
} as const;

async function loadStatus(id: string, now: Date): Promise<EmailTestStatus | null> {
  const prisma = getPrisma();
  const row = await prisma.messageOutbox.findFirst({
    where: { id, templateKey: "SYSTEM_TEST_EMAIL", eventId: null },
    select: rowSelect,
  });
  if (!row) return null;
  const events = await prisma.messageProviderEvent.findMany({
    where: { messageOutboxId: id },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: { mappedDeliveryStatus: true, occurredAt: true },
  });
  return mapEmailTestStatus(row as EmailTestRow, events, now);
}

/**
 * The card's polling read. Only a test email this administrator sent, and only its own status: any other id, any other
 * template and any other administrator's test read as "not found".
 */
export async function readEmailTestStatus(testId: string, userId: string, now: Date = new Date()): Promise<EmailTestStatus | null> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(testId)) return null;
  const owner = await getPrisma().messageOutbox.findFirst({
    where: { id: testId, templateKey: "SYSTEM_TEST_EMAIL", eventId: null },
    select: { metadata: true },
  });
  const meta = owner?.metadata && typeof owner.metadata === "object" ? owner.metadata as Record<string, unknown> : null;
  if (!meta || meta.trigger !== SYSTEM_TEST_EMAIL_TRIGGER || meta.testedByUserId !== userId) return null;
  return loadStatus(testId, now);
}

export type EmailTestRun =
  | { kind: "invalid" }
  | { kind: "rate-limited"; nextAllowedAt: string }
  | { kind: "not-configured" }
  | { kind: "started"; status: EmailTestStatus };

/** Validates, charges the limit, queues one message, delivers it now, audits, and returns where it stands. */
export async function runEmailTest(input: { user: { id: string }; body: unknown; now?: Date }): Promise<EmailTestRun> {
  const now = input.now ?? new Date();
  const parsed = emailTestInputSchema.safeParse(input.body);
  if (!parsed.success) return { kind: "invalid" };

  const limit = await checkSystemEmailTestRateLimit(input.user.id);
  if (!limit.allowed) return { kind: "rate-limited", nextAllowedAt: nextAllowedAt(limit, now).toISOString() };

  let queued: { messageId: string; ref: string };
  try {
    queued = await enqueueSystemTestEmail({ to: parsed.data.to, actorUserId: input.user.id });
  } catch (error) {
    if (error instanceof AccountEmailNotConfiguredError) return { kind: "not-configured" };
    throw error;
  }

  try {
    await processAccountEmailQueue({ messageIds: [queued.messageId], limit: 1 });
  } catch (error) {
    // Not configured at the provider, or the loop failed outright. The row is closed below; nothing is retried later.
    logError("The System report test email could not be delivered", error, { testRef: queued.ref });
  }
  // A test is one shot. A row still PENDING (nothing claimed, or rescheduled for a retry) is closed, so it never sends a
  // surprise email later. A PROCESSING row is left alone: its worker may still finish it, and the card keeps polling. If
  // nobody finishes it, the sweep closes it unsent (`closeAbandonedSystemTests`).
  await getPrisma().messageOutbox.updateMany({
    where: { id: queued.messageId, status: "PENDING" },
    data: { status: "CANCELLED", failedAt: now, lockedAt: null, lockToken: null },
  }).catch((error) => logError("Could not close an unsent System report test email", error, { testRef: queued.ref }));

  const status = (await loadStatus(queued.messageId, now))!;
  try {
    await writeAuditLog({
      actorUserId: input.user.id,
      action: "SYSTEM_REPORT_EMAIL_TEST",
      entityType: "MessageOutbox",
      entityId: queued.messageId,
      summary: "A system administrator sent a System report test email.",
      metadata: { outboxId: queued.messageId, testRef: queued.ref, outcome: status.state },
    });
  } catch (error) {
    logError("Could not audit a System report test email", error, { testRef: queued.ref });
  }
  return { kind: "started", status };
}
