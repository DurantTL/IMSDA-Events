import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { deleteAsset } from "@/modules/events/asset-storage";
import { messageFileSweepGraceHours } from "@/modules/communications/message-file-config";
import { effectiveSweepGraceHours } from "@/modules/communications/message-file-rules";
import {
  errnoCode,
  findReferencedMessageFileIds,
  removeStoredBytes,
  type PendingCleanup,
} from "@/modules/communications/message-file-storage";

/**
 * The message file sweep (#845): finds uploads nothing refers to any more, and removes them.
 *
 * Two rules come before everything else.
 * - It reports unless it is told to delete. `mode: "dry-run"` writes nothing and removes nothing; only `"apply"`
 *   deletes, and a human chooses that (the CLI's `--apply`, or `MESSAGE_FILE_SWEEP_DELETE=true` for the scheduled run).
 * - It never removes a file anything refers to, in any event, and never one younger than the grace period (24 hours at
 *   the least, whatever is configured).
 *
 * A file is a candidate when it is older than the grace period and has no link row. Each candidate is checked again
 * inside the delete transaction, after its row is locked `FOR UPDATE` (see `lockMessageFilesForShare` for the other half
 * of the handshake with saves), against every place a body can name it. The row is deleted together with a cleanup
 * record for its bytes; the bytes are removed only after that commits, and a failure leaves the record to be retried.
 */

/** Files deleted by one sweep, so a backlog is cleared over several runs and one run stays short. */
export const MESSAGE_FILE_SWEEP_BATCH_LIMIT = 100;
/** Rows read per page while looking for candidates, since many unlinked pictures are kept by the text that names them. */
const CANDIDATE_PAGE_SIZE = 200;
/** The most rows one sweep looks at, so a large library of in-use pictures cannot make the run long. */
const CANDIDATE_SCAN_LIMIT = 2_000;
/** A failed disk delete is not retried more often than this. */
export const CLEANUP_RETRY_AFTER_MS = 30 * 60 * 1000;
const CLEANUP_RETRY_BATCH_LIMIT = 100;
const RESERVATION_BATCH_LIMIT = 100;

export type SweepMode = "dry-run" | "apply";

export type MessageFileSweepReport = {
  mode: SweepMode;
  graceHours: number;
  cutoff: string;
  candidates: {
    count: number;
    bytes: number;
    byEvent: Array<{ eventId: string; count: number; bytes: number }>;
  };
  /** Rows deleted. Their bytes are removed after the commit; `bytesRemoved` is what actually left the disk. */
  deleted: { count: number; bytes: number };
  /** Candidates that gained a reference between the first look and the locked re-check, and were kept. */
  keptAtRecheck: number;
  /** Files, from this run and earlier ones, whose bytes were deleted from disk, and how many bytes that freed. */
  bytesRemoved: { count: number; bytes: number };
  cleanup: { pending: number; retried: number; succeeded: number; failed: number };
  reservations: { expired: number; reconciled: number };
  /** Dry run only: what an apply run would delete. No storage keys. */
  wouldDelete: Array<{ id: string; eventId: string; filename: string; sizeBytes: number; createdAt: string }>;
};

type Candidate = { id: string; eventId: string; filename: string; sizeBytes: number; createdAt: Date };

export async function sweepMessageFiles(
  options: { now?: Date; mode?: SweepMode; graceHours?: number; limit?: number; client?: PrismaClient } = {},
): Promise<MessageFileSweepReport> {
  const client = options.client ?? getPrisma();
  const now = options.now ?? new Date();
  const mode: SweepMode = options.mode === "apply" ? "apply" : "dry-run";
  // The floor holds whatever a caller asks for.
  const graceHours = options.graceHours === undefined ? messageFileSweepGraceHours() : effectiveSweepGraceHours(options.graceHours);
  const limit = Math.max(1, Math.min(options.limit ?? MESSAGE_FILE_SWEEP_BATCH_LIMIT, MESSAGE_FILE_SWEEP_BATCH_LIMIT));
  const cutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1000);

  const report: MessageFileSweepReport = {
    mode,
    graceHours,
    cutoff: cutoff.toISOString(),
    candidates: { count: 0, bytes: 0, byEvent: [] },
    deleted: { count: 0, bytes: 0 },
    keptAtRecheck: 0,
    bytesRemoved: { count: 0, bytes: 0 },
    cleanup: { pending: 0, retried: 0, succeeded: 0, failed: 0 },
    reservations: { expired: 0, reconciled: 0 },
    wouldDelete: [],
  };

  if (mode === "apply") {
    // Unfinished work from earlier runs goes first, so a file this run just failed to remove is not retried in the same run.
    await retryCleanup(client, now, report);
    await reconcileExpiredReservations(client, now, report);
  } else {
    report.cleanup.pending = await client.messageFileStorageCleanup.count();
    report.reservations.expired = await client.messageFileUploadReservation.count({ where: { expiresAt: { lt: now } } });
  }

  const candidates = await findCandidates(client, cutoff, limit);
  const byEvent = new Map<string, { count: number; bytes: number }>();
  for (const candidate of candidates) {
    const entry = byEvent.get(candidate.eventId) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += candidate.sizeBytes;
    byEvent.set(candidate.eventId, entry);
    report.candidates.count += 1;
    report.candidates.bytes += candidate.sizeBytes;
  }
  report.candidates.byEvent = [...byEvent.entries()].map(([eventId, value]) => ({ eventId, ...value }));

  if (mode === "dry-run") {
    report.wouldDelete = candidates.map((candidate) => ({
      id: candidate.id,
      eventId: candidate.eventId,
      filename: candidate.filename,
      sizeBytes: candidate.sizeBytes,
      createdAt: candidate.createdAt.toISOString(),
    }));
    return report;
  }

  if (candidates.length > 0) await deleteCandidates(client, candidates, cutoff, now, report);
  return report;
}

/**
 * Old files with no link row and no body naming them. Read in pages because an unlinked picture a template body names
 * is normal (its only reference is text) and would otherwise fill the batch and hide the real orphans behind it.
 * The caller re-checks inside the delete transaction; this is only the shortlist.
 */
async function findCandidates(client: PrismaClient, cutoff: Date, limit: number): Promise<Candidate[]> {
  const found: Candidate[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  while (found.length < limit && scanned < CANDIDATE_SCAN_LIMIT) {
    const page = await client.messageFile.findMany({
      where: {
        createdAt: { lt: cutoff },
        templateVersions: { none: {} },
        announcements: { none: {} },
        outboxLinks: { none: {} },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CANDIDATE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, eventId: true, filename: true, sizeBytes: true, createdAt: true },
    });
    if (page.length === 0) break;
    scanned += page.length;
    cursor = page[page.length - 1].id;
    const referenced = await findReferencedMessageFileIds(client, page.map((row) => row.id));
    for (const row of page) {
      if (!referenced.has(row.id) && found.length < limit) found.push(row);
    }
    if (page.length < CANDIDATE_PAGE_SIZE) break;
  }
  return found;
}

/**
 * One transaction: lock the candidates, re-check every reference on fresh statements, delete what is still unreferenced
 * together with a cleanup record for each, and one audit entry per event with counts only. The bytes go after the commit.
 */
async function deleteCandidates(
  client: PrismaClient,
  candidates: readonly Candidate[],
  cutoff: Date,
  now: Date,
  report: MessageFileSweepReport,
) {
  let outcome: { cleanup: PendingCleanup[]; kept: number; bytes: number };
  try {
    outcome = await client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; eventId: string; storageKey: string; sizeBytes: number }>>(Prisma.sql`
        SELECT "id", "eventId", "storageKey", "sizeBytes" FROM "MessageFile"
        WHERE "id" IN (${Prisma.join(candidates.map((candidate) => candidate.id))}) AND "createdAt" < ${cutoff}
        ORDER BY "id"
        FOR UPDATE
      `);
      // Read only now that the rows are locked: a save that held a share lock has committed by this point.
      const referenced = await findReferencedMessageFileIds(tx, locked.map((row) => row.id));
      const doomed = locked.filter((row) => !referenced.has(row.id));
      const kept = candidates.length - doomed.length;
      if (doomed.length === 0) return { cleanup: [], kept, bytes: 0 };
      await tx.messageFile.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } });
      const cleanup: PendingCleanup[] = [];
      for (const row of doomed) {
        const record = await tx.messageFileStorageCleanup.upsert({
          where: { storageKey: row.storageKey },
          create: { eventId: row.eventId, storageKey: row.storageKey, sizeBytes: row.sizeBytes, reason: "SWEEP" },
          update: {},
          select: { id: true, eventId: true, storageKey: true, sizeBytes: true },
        });
        cleanup.push(record);
      }
      const perEvent = new Map<string, { count: number; bytes: number }>();
      for (const row of doomed) {
        const entry = perEvent.get(row.eventId) ?? { count: 0, bytes: 0 };
        entry.count += 1;
        entry.bytes += row.sizeBytes;
        perEvent.set(row.eventId, entry);
      }
      for (const [eventId, entry] of perEvent) {
        await tx.auditLog.create({
          data: {
            eventId,
            actorUserId: null,
            action: "MESSAGE_FILES_SWEPT",
            entityType: "MessageFile",
            correlationId: randomUUID(),
            // Counts and sizes only: never a name, a path or a hash.
            summary: `Removed ${entry.count} unused message file${entry.count === 1 ? "" : "s"} (${entry.bytes} bytes) that nothing referenced.`,
            metadata: { count: entry.count, bytes: entry.bytes, graceHours: report.graceHours },
          },
        });
      }
      return { cleanup, kept, bytes: doomed.reduce((sum, row) => sum + row.sizeBytes, 0) };
    });
  } catch (error) {
    // Nothing was deleted (the transaction rolled back); the files are candidates again on the next run.
    logError("The message file sweep could not delete a batch", error, { candidates: candidates.length });
    return;
  }
  report.keptAtRecheck += outcome.kept;
  report.deleted.count += outcome.cleanup.length;
  report.deleted.bytes += outcome.bytes;
  if (outcome.cleanup.length > 0) {
    const result = await removeStoredBytes(client, outcome.cleanup, now);
    report.bytesRemoved.count += result.removed;
    report.bytesRemoved.bytes += result.removedBytes;
    report.cleanup.failed += result.failed;
  }
}

/** Retries the records of files whose rows are gone but whose bytes are not, oldest first, never more often than the retry interval. */
async function retryCleanup(client: PrismaClient, now: Date, report: MessageFileSweepReport) {
  const due = await client.messageFileStorageCleanup.findMany({
    where: { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(now.getTime() - CLEANUP_RETRY_AFTER_MS) } }] },
    orderBy: { createdAt: "asc" },
    take: CLEANUP_RETRY_BATCH_LIMIT,
    select: { id: true, eventId: true, storageKey: true, sizeBytes: true },
  });
  report.cleanup.pending = await client.messageFileStorageCleanup.count();
  if (due.length === 0) return;
  const result = await removeStoredBytes(client, due, now);
  report.cleanup.retried = due.length;
  report.cleanup.succeeded = result.removed;
  report.cleanup.failed += result.failed;
  report.cleanup.pending -= result.removed;
  report.bytesRemoved.count += result.removed;
  report.bytesRemoved.bytes += result.removedBytes;
}

/**
 * An upload that reserved room and never finished (the process died, or its bytes could not be deleted) is released once
 * its reservation has expired. Each is handled under a lock on its own row, which the upload's commit also needs, so the
 * two cannot both win: if a file row now has the key, only the reservation goes; otherwise the bytes go and then the
 * reservation, or, if the bytes cannot be removed, the reservation becomes a cleanup record in the same transaction.
 */
async function reconcileExpiredReservations(client: PrismaClient, now: Date, report: MessageFileSweepReport) {
  const expired = await client.messageFileUploadReservation.findMany({
    where: { expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" },
    take: RESERVATION_BATCH_LIMIT,
    select: { id: true },
  });
  report.reservations.expired = expired.length;
  for (const { id } of expired) {
    try {
      const done = await client.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ eventId: string; storageKey: string; sizeBytes: number }>>(Prisma.sql`
          SELECT "eventId", "storageKey", "sizeBytes" FROM "MessageFileUploadReservation"
          WHERE "id" = ${id} AND "expiresAt" < ${now}
          FOR UPDATE
        `);
        const reservation = locked[0];
        if (!reservation) return false;
        const hasRow = await tx.messageFile.findUnique({ where: { storageKey: reservation.storageKey }, select: { id: true } });
        if (!hasRow) {
          try {
            await deleteAsset(reservation.storageKey);
          } catch (error) {
            const code = errnoCode(error);
            logError("An abandoned upload's bytes could not be deleted; it will be retried", error, { reservationId: id, eventId: reservation.eventId, errorCode: code });
            await tx.messageFileStorageCleanup.upsert({
              where: { storageKey: reservation.storageKey },
              create: {
                eventId: reservation.eventId,
                storageKey: reservation.storageKey,
                sizeBytes: reservation.sizeBytes,
                reason: "UPLOAD_ABORTED",
                attempts: 1,
                lastErrorCode: code,
                lastAttemptAt: now,
              },
              update: {},
            });
          }
        }
        await tx.messageFileUploadReservation.deleteMany({ where: { id } });
        return true;
      });
      if (done) report.reservations.reconciled += 1;
    } catch (error) {
      logError("An expired upload reservation could not be reconciled", error, { reservationId: id });
    }
  }
}
