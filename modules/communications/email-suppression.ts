import "server-only";

import { randomUUID } from "node:crypto";
import type { EmailSuppressionReason, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { announcementRecipientEmail } from "@/modules/communications/announcement-broadcast-preview";
import { findActiveAddressSuppressions, normalizeSuppressionEmail } from "@/modules/communications/effective-delivery";

/**
 * Addresses that receive no email (#863). The rule (Caleb, Oct 23): a hard bounce or a spam complaint stops ALL email to
 * the address, including confirmations and receipts; a soft bounce is only recorded; a system administrator can
 * re-enable an address, audited with who and when.
 *
 * The decision itself lives in `effective-delivery.ts` and is enforced by the delivery worker. This module records a
 * suppression when SES reports one, re-enables it, and lists what staff are shown. Audit entries and logs carry ids and
 * counts only, never the address; the normalized address is stored only on the suppression row, which needs it.
 */

export type SuppressionActor = { id: string; globalRole?: string | null };

export class EmailSuppressionError extends Error {
  constructor(public readonly code: "SYSTEM_ADMIN_REQUIRED" | "SUPPRESSION_NOT_FOUND", message: string) {
    super(message);
    this.name = "EmailSuppressionError";
  }
}

type Tx = Prisma.TransactionClient;

export type SuppressInput = {
  normalizedEmail: string;
  reason: EmailSuppressionReason;
  provider: string;
  occurredAt: Date;
  sourceProviderEventId: string;
  sourceMessageOutboxId: string | null;
};

/**
 * Switches suppression on for one address, idempotently and replay-safely. Returns whether this call changed anything.
 *
 * - No row yet: created.
 * - Active already: left alone, except a complaint outranks a bounce.
 * - Re-enabled: only an event that happened AFTER the re-enable suppresses it again. An older event (a replayed or
 *   late-arriving notification) can never undo an administrator's decision.
 */
export async function suppressAddress(tx: Tx, input: SuppressInput): Promise<{ changed: boolean; suppressionId: string }> {
  const normalizedEmail = normalizeSuppressionEmail(input.normalizedEmail);
  const existing = await tx.emailAddressSuppression.findUnique({ where: { normalizedEmail } });
  let suppressionId: string;
  let changed = false;
  if (!existing) {
    const created = await tx.emailAddressSuppression.create({
      data: {
        normalizedEmail,
        reason: input.reason,
        provider: input.provider,
        sourceProviderEventId: input.sourceProviderEventId,
        sourceMessageOutboxId: input.sourceMessageOutboxId,
        suppressedAt: input.occurredAt,
      },
      select: { id: true },
    });
    suppressionId = created.id;
    changed = true;
  } else if (existing.reenabledAt === null) {
    suppressionId = existing.id;
    if (existing.reason === "BOUNCE" && input.reason === "COMPLAINT") {
      await tx.emailAddressSuppression.update({ where: { id: existing.id }, data: { reason: "COMPLAINT" } });
      changed = true;
    }
  } else if (input.occurredAt > existing.reenabledAt) {
    suppressionId = existing.id;
    await tx.emailAddressSuppression.update({
      where: { id: existing.id },
      data: {
        reason: input.reason,
        provider: input.provider,
        sourceProviderEventId: input.sourceProviderEventId,
        sourceMessageOutboxId: input.sourceMessageOutboxId,
        suppressedAt: input.occurredAt,
        reenabledAt: null,
        reenabledByUserId: null,
      },
    });
    changed = true;
  } else {
    return { changed: false, suppressionId: existing.id };
  }
  if (changed) {
    await tx.auditLog.create({
      data: {
        action: "EMAIL_ADDRESS_SUPPRESSED",
        entityType: "EmailAddressSuppression",
        entityId: suppressionId,
        correlationId: randomUUID(),
        summary: input.reason === "COMPLAINT"
          ? "Stopped all email to an address after a spam complaint."
          : "Stopped all email to an address after a permanent bounce.",
        // Ids only: never the address.
        metadata: { suppressionId, reason: input.reason, provider: input.provider, providerEventId: input.sourceProviderEventId, messageId: input.sourceMessageOutboxId },
      },
    });
  }
  return { changed, suppressionId };
}

/**
 * Re-enables an address. Only a system administrator may, checked here in the module every caller goes through and not
 * only in a route. Audited with the actor; the row keeps who and when. Idempotent: an address that is already enabled
 * reports `changed: false`.
 */
export async function reenableSuppressedAddress(input: {
  suppressionId: string;
  actor: SuppressionActor | null | undefined;
  now?: Date;
}): Promise<{ changed: boolean }> {
  if (!input.actor || input.actor.globalRole !== "SYSTEM_ADMIN") {
    throw new EmailSuppressionError("SYSTEM_ADMIN_REQUIRED", "Only a system administrator can re-enable an address.");
  }
  const actorUserId = input.actor.id;
  const now = input.now ?? new Date();
  return getPrisma().$transaction(async (tx) => {
    const row = await tx.emailAddressSuppression.findUnique({ where: { id: input.suppressionId }, select: { id: true, reason: true, reenabledAt: true } });
    if (!row) throw new EmailSuppressionError("SUPPRESSION_NOT_FOUND", "That address is no longer in the list.");
    if (row.reenabledAt) return { changed: false };
    const updated = await tx.emailAddressSuppression.updateMany({
      where: { id: row.id, reenabledAt: null },
      data: { reenabledAt: now, reenabledByUserId: actorUserId },
    });
    if (updated.count !== 1) return { changed: false };
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "EMAIL_ADDRESS_REENABLED",
        entityType: "EmailAddressSuppression",
        entityId: row.id,
        correlationId: randomUUID(),
        summary: "Re-enabled email to an address that had been suppressed.",
        // Ids only: never the address.
        metadata: { suppressionId: row.id, reason: row.reason, actorUserId },
      },
    });
    return { changed: true };
  });
}

export type SuppressedAddressRow = {
  id: string;
  address: string;
  reason: EmailSuppressionReason;
  suppressedAt: string;
};

export type SuppressionSummary = { total: number; rows: SuppressedAddressRow[] };

/** Active suppressions for Email health (system administrators only), newest first, with the true total beside a capped list. */
export async function listActiveSuppressions(limit = 100): Promise<SuppressionSummary> {
  const prisma = getPrisma();
  const where = { reenabledAt: null } as const;
  const [total, rows] = await Promise.all([
    prisma.emailAddressSuppression.count({ where }),
    prisma.emailAddressSuppression.findMany({
      where,
      orderBy: [{ suppressedAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, normalizedEmail: true, reason: true, suppressedAt: true },
    }),
  ]);
  return {
    total,
    rows: rows.map((row) => ({ id: row.id, address: row.normalizedEmail, reason: row.reason, suppressedAt: row.suppressedAt.toISOString() })),
  };
}

export type EventSuppressionMarks = {
  /** Registration id to the reason its contact address is not being sent to. */
  registrations: Record<string, EmailSuppressionReason>;
  /** Registration attendee id to the reason that attendee's own address is not being sent to. */
  attendees: Record<string, EmailSuppressionReason>;
};

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * The staff warning for an event's registrations (#863): which contacts and attendees are not being sent to. Derived from
 * the registrations the event already holds, so it never lists an address the event has no registration for. Cheap when
 * nothing is suppressed (one count).
 */
export async function listEventSuppressionMarks(eventId: string): Promise<EventSuppressionMarks> {
  const prisma = getPrisma();
  const empty: EventSuppressionMarks = { registrations: {}, attendees: {} };
  if ((await prisma.emailAddressSuppression.count({ where: { reenabledAt: null } })) === 0) return empty;
  const registrations = await prisma.registration.findMany({
    where: { eventId },
    select: {
      id: true,
      contactSnapshot: true,
      accountHolderPerson: { select: { normalizedEmail: true } },
      attendees: { select: { id: true, profileSnapshot: true, person: { select: { normalizedEmail: true } } } },
    },
  });
  const contactEmail = new Map<string, string>();
  const attendeeEmail = new Map<string, string>();
  for (const registration of registrations) {
    const email = announcementRecipientEmail(registration.contactSnapshot, registration.accountHolderPerson?.normalizedEmail ?? null);
    if (email) contactEmail.set(registration.id, email);
    for (const attendee of registration.attendees) {
      const profile = recordFrom(attendee.profileSnapshot);
      const own = typeof profile.email === "string" && profile.email.trim() ? profile.email : attendee.person.normalizedEmail ?? "";
      const normalized = normalizeSuppressionEmail(own);
      if (normalized) attendeeEmail.set(attendee.id, normalized);
    }
  }
  const suppressed = await findActiveAddressSuppressions(prisma, [...contactEmail.values(), ...attendeeEmail.values()]);
  const marks: EventSuppressionMarks = { registrations: {}, attendees: {} };
  for (const [registrationId, email] of contactEmail) {
    const hit = suppressed.get(email);
    if (hit) marks.registrations[registrationId] = hit.reason;
  }
  for (const [attendeeId, email] of attendeeEmail) {
    const hit = suppressed.get(email);
    if (hit) marks.attendees[attendeeId] = hit.reason;
  }
  return marks;
}
