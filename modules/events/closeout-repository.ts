import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import type { EventPermission } from "@/modules/access/permissions";
import { countOpenInvoiceDrafts } from "@/modules/invoices/repository";
import { loadEventMoneyReport, loadUnmatchedSquareSummary } from "@/modules/payments/event-money-report-repository";
import {
  buildCloseoutChecklist,
  CLOSEOUT_NOTE_MAX_LENGTH,
  closeoutSnapshot,
  parseCloseoutSnapshot,
  signoffRefusal,
  summarizeCloseout,
  type CloseoutCheck,
  type CloseoutSummary,
} from "@/modules/events/closeout-domain";
import { EventLifecycleError, transitionEventLifecycle, type LifecycleActor } from "@/modules/events/lifecycle-repository";
import {
  closeoutSignoffPermissions,
  effectiveLifecycleState,
  eventLifecycleStateLabel,
  LIFECYCLE_REASON_MAX_LENGTH,
  type EventLifecycleStateName,
} from "@/modules/events/lifecycle-state";

/**
 * Event closeout (#1515): the checklist, the finance sign-off that moves an event from Financial reconciliation to
 * Closed, and the reopening. Built on today's payment, refund, invoice, message and waitlist records and the Event money
 * report (#1962); the ledger is not read. Sign-offs and reopenings are append-only rows (database trigger), so reopening
 * an event never changes or removes an earlier sign-off.
 */

export type CloseoutErrorCode =
  | "BLOCKING_CHECKS"
  | "WARNINGS_NOT_ACKNOWLEDGED"
  | "NOTE_TOO_LONG"
  | "REASON_REQUIRED"
  | "REASON_TOO_LONG"
  | "STALE_VERSION"
  | "ALREADY_DONE"
  | "NOT_FOUND";

export class CloseoutError extends Error {
  constructor(public readonly code: CloseoutErrorCode, message: string, public readonly currentState?: EventLifecycleStateName) {
    super(message);
    this.name = "CloseoutError";
  }
}

export function canSignOff(permissions: readonly EventPermission[]) {
  return closeoutSignoffPermissions.some((permission) => permissions.includes(permission));
}

/** A value that could not be read is null, never zero: the domain turns null into a check that is not ready. */
async function readOrNull<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logError(`Event closeout: ${what} could not be read`, error);
    return null;
  }
}

/** Gathers the facts and runs the pure checklist. Reads only. */
export async function loadCloseoutChecklist(eventId: string): Promise<{ checks: CloseoutCheck[]; summary: CloseoutSummary }> {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { billingMode: true } });
  if (!event) throw new CloseoutError("NOT_FOUND", "That event no longer exists.");
  const [money, draftInvoices, failedMessages, waitlistWaiting, square] = await Promise.all([
    readOrNull("the money report", () => loadEventMoneyReport(eventId)),
    readOrNull("draft invoices", () => countOpenInvoiceDrafts(eventId)),
    // A failed message counts until a later copy of it was sent or queued (a retry), as the retry tool judges it.
    readOrNull("failed messages", () => prisma.messageOutbox.count({
      where: {
        eventId,
        status: "FAILED",
        templateKey: { not: "SYSTEM_TEST_EMAIL" },
        retries: { none: { status: { in: ["SENT", "CAPTURED", "PENDING", "PROCESSING"] } } },
      },
    })),
    readOrNull("the waitlist", () => prisma.registrationWaitlistEntry.count({ where: { eventId, status: "WAITING" } })),
    loadUnmatchedSquareSummary(eventId),
  ]);
  const checks = buildCloseoutChecklist({
    eventId,
    report: money?.report ?? null,
    churchBilled: event.billingMode === "DEFERRED_ORGANIZATION_INVOICE",
    draftInvoices,
    failedMessages,
    waitlistWaiting,
    square,
  });
  return { checks, summary: summarizeCloseout(checks) };
}

export type CloseoutHistoryEntry = {
  id: string;
  signedByName: string;
  signedAt: string;
  note: string | null;
  warningsAcknowledged: boolean;
  snapshot: ReturnType<typeof parseCloseoutSnapshot>;
  reopened: { id: string; byName: string; at: string; reason: string } | null;
};

export type CloseoutView = {
  eventId: string;
  eventName: string;
  state: EventLifecycleStateName;
  stateLabel: string;
  lifecycleVersion: number;
  checks: CloseoutCheck[];
  summary: CloseoutSummary;
  /** Newest first. The first entry that is not reopened is the current sign-off while the event is Closed. */
  history: CloseoutHistoryEntry[];
  /** Reopenings of an event closed before sign-offs existed: no sign-off to attach them to. */
  unlinkedReopenings: Array<{ id: string; byName: string; at: string; reason: string }>;
};

export async function getCloseoutView(eventId: string): Promise<CloseoutView | null> {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { name: true, isPublished: true, archivedAt: true, lifecycleState: true, lifecycleVersion: true },
  });
  if (!event) return null;
  const state = effectiveLifecycleState(event);
  const [{ checks, summary }, signoffs, unlinked] = await Promise.all([
    loadCloseoutChecklist(eventId),
    prisma.eventCloseoutSignoff.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: { reopenings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1 } },
    }),
    prisma.eventCloseoutReopening.findMany({ where: { eventId, signoffId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 }),
  ]);
  return {
    eventId,
    eventName: event.name,
    state,
    stateLabel: eventLifecycleStateLabel(state),
    lifecycleVersion: event.lifecycleVersion,
    checks,
    summary,
    history: signoffs.map((row) => {
      const reopening = row.reopenings[0];
      return {
        id: row.id,
        signedByName: row.signedByNameSnapshot,
        signedAt: row.createdAt.toISOString(),
        note: row.note,
        warningsAcknowledged: row.warningsAcknowledged,
        snapshot: parseCloseoutSnapshot(row.checklistSnapshot),
        reopened: reopening ? { id: reopening.id, byName: reopening.reopenedByNameSnapshot, at: reopening.createdAt.toISOString(), reason: reopening.reason } : null,
      };
    }),
    unlinkedReopenings: unlinked.map((row) => ({ id: row.id, byName: row.reopenedByNameSnapshot, at: row.createdAt.toISOString(), reason: row.reason })),
  };
}

async function signerName(userId: string) {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { displayName: true } });
  const name = user?.displayName.trim();
  if (!name) throw new CloseoutError("NOT_FOUND", "Your account could not be found. Sign in again and try once more.");
  return name;
}

async function assertVersion(tx: Prisma.TransactionClient, eventId: string, expectedVersion: number, state: EventLifecycleStateName) {
  const row = await tx.event.findUnique({ where: { id: eventId }, select: { lifecycleVersion: true } });
  if (!row || row.lifecycleVersion !== expectedVersion) {
    throw new CloseoutError("STALE_VERSION", "This event changed since you opened the page. Nothing was changed; reload the page, review it and try again.", state);
  }
}

export type SignOffInput = {
  eventId: string;
  actor: LifecycleActor;
  /** The signer ticked the box saying the open warnings were reviewed. */
  acknowledgeWarnings: boolean;
  note?: string | null;
  /** The event's `lifecycleVersion` on the page the signer reviewed. */
  expectedVersion: number;
  now?: Date;
};

/**
 * Signs the event off and closes it, in one transaction with the lifecycle transition (Financial reconciliation to
 * Closed): the event row is locked, the checklist is read again on the server (nothing is trusted from the page), any
 * blocking check refuses, open warnings must be acknowledged, then the sign-off row (name and checklist snapshot) is
 * written and the transition's evidence carries its id. Any failure leaves nothing behind.
 */
export async function signOffEvent(input: SignOffInput) {
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note && note.length > CLOSEOUT_NOTE_MAX_LENGTH) {
    throw new CloseoutError("NOTE_TOO_LONG", `The note can be at most ${CLOSEOUT_NOTE_MAX_LENGTH} characters.`);
  }
  const name = await signerName(input.actor.userId);
  let signoffId: string | null = null;
  const result = await transitionEventLifecycle({
    eventId: input.eventId,
    toState: "CLOSED",
    expectedFromState: "FINANCIAL_RECONCILIATION",
    actor: input.actor,
    now: input.now,
    closeout: {
      action: "SIGN_OFF",
      run: async (tx, context) => {
        await assertVersion(tx, input.eventId, input.expectedVersion, context.fromState);
        const { checks, summary } = await loadCloseoutChecklist(input.eventId);
        const refusal = signoffRefusal(summary, input.acknowledgeWarnings);
        if (refusal) throw new CloseoutError(refusal.code, refusal.message, context.fromState);
        const acknowledged = summary.warning > 0 && input.acknowledgeWarnings;
        const row = await tx.eventCloseoutSignoff.create({
          data: {
            eventId: input.eventId,
            signedByUserId: input.actor.userId,
            signedByNameSnapshot: name,
            checklistSnapshot: closeoutSnapshot(checks),
            warningsAcknowledged: acknowledged,
            note,
            transitionId: context.transitionId,
          },
          select: { id: true },
        });
        signoffId = row.id;
        await writeAuditLog({
          eventId: input.eventId,
          actorUserId: input.actor.userId,
          action: "EVENT_CLOSEOUT_SIGNED_OFF",
          entityType: "EventCloseoutSignoff",
          entityId: row.id,
          summary: `Signed off the closeout and closed the event: ${context.name}.`,
          metadata: { signoffId: row.id, warnings: summary.warning, readyChecks: summary.ready, warningsAcknowledged: acknowledged, hasNote: note !== null },
        }, tx);
        return { evidence: { closeout: "SIGN_OFF", signoffId: row.id, warnings: summary.warning, warningsAcknowledged: acknowledged } };
      },
    },
  });
  if (!result.changed || !signoffId) {
    throw new CloseoutError("ALREADY_DONE", "This event is already closed. Nothing was changed.", result.fromState);
  }
  return { signoffId, transitionId: result.transitionId ?? null, lifecycleVersion: result.lifecycleVersion };
}

export type ReopenInput = {
  eventId: string;
  actor: LifecycleActor;
  reason: string;
  expectedVersion: number;
  now?: Date;
};

/**
 * Reopens a closed event (Closed to Financial reconciliation) with a required reason. The earlier sign-off is never
 * touched: the reopening is its own row pointing at it, so the history reads "signed off by X, reopened by Y: reason".
 */
export async function reopenClosedEvent(input: ReopenInput) {
  const reason = input.reason.trim();
  if (!reason) throw new CloseoutError("REASON_REQUIRED", "Say why the event is being reopened.");
  if (reason.length > LIFECYCLE_REASON_MAX_LENGTH) {
    throw new CloseoutError("REASON_TOO_LONG", `The reason can be at most ${LIFECYCLE_REASON_MAX_LENGTH} characters.`);
  }
  const name = await signerName(input.actor.userId);
  let reopeningId: string | null = null;
  let result;
  try {
    result = await transitionEventLifecycle({
      eventId: input.eventId,
      toState: "FINANCIAL_RECONCILIATION",
      expectedFromState: "CLOSED",
      actor: input.actor,
      reason,
      now: input.now,
      closeout: {
        action: "REOPEN",
        run: async (tx, context) => {
          await assertVersion(tx, input.eventId, input.expectedVersion, context.fromState);
          // The sign-off now in force: the newest one nothing has reopened yet (null for an event closed the old way).
          const current = await tx.eventCloseoutSignoff.findFirst({
            where: { eventId: input.eventId, reopenings: { none: {} } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          const row = await tx.eventCloseoutReopening.create({
            data: {
              eventId: input.eventId,
              signoffId: current?.id ?? null,
              reopenedByUserId: input.actor.userId,
              reopenedByNameSnapshot: name,
              reason,
              transitionId: context.transitionId,
            },
            select: { id: true },
          });
          reopeningId = row.id;
          await writeAuditLog({
            eventId: input.eventId,
            actorUserId: input.actor.userId,
            action: "EVENT_CLOSEOUT_REOPENED",
            entityType: "EventCloseoutReopening",
            entityId: row.id,
            summary: `Reopened a closed event: ${context.name}.`,
            metadata: { reopeningId: row.id, signoffId: current?.id ?? null },
          }, tx);
          return { evidence: { closeout: "REOPEN", reopeningId: row.id, signoffId: current?.id ?? null } };
        },
      },
    });
  } catch (error) {
    if (error instanceof EventLifecycleError && error.code === "REASON_TOO_LONG") throw new CloseoutError("REASON_TOO_LONG", error.message);
    throw error;
  }
  if (!result.changed || !reopeningId) {
    throw new CloseoutError("ALREADY_DONE", "This event is already open for reconciliation. Nothing was changed.", result.fromState);
  }
  return { reopeningId, transitionId: result.transitionId ?? null, lifecycleVersion: result.lifecycleVersion };
}
