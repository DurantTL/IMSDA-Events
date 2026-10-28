import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { deleteAsset, readAsset, writeStoredFileAt } from "@/modules/events/asset-storage";
import {
  attachmentSetIssue,
  inlineImageSetIssue,
  isMessageImageType,
  MAX_INLINE_IMAGE_BYTES,
  MAX_MESSAGE_FILE_BYTES,
  formatFileSize,
  MAX_MESSAGE_FILES_PER_EVENT,
  MESSAGE_FILE_RESERVATION_TTL_MS,
  MESSAGE_FILE_TYPES,
  messageFileIdsInHtml,
  messageFileIdsInMarkdown,
  MessageFileDeliveryError,
  messageFileUrl,
  safeMessageFileName,
  type MessageFileRecord,
} from "@/modules/communications/message-file-rules";
import { sniffMessageFileType } from "@/modules/communications/message-file-sniff";
import { messageFileEventQuotaBytes, messageFileEventQuotaMb } from "@/modules/communications/message-file-config";
import {
  SWEEP_TRANSACTION_OPTIONS,
  errnoCode,
  findReferencedMessageFileIds,
  removeStoredBytes,
} from "@/modules/communications/message-file-storage";

export class MessageFileError extends Error {
  constructor(
    public readonly code:
      | "FILE_REQUIRED"
      | "FILE_EMPTY"
      | "FILE_TOO_LARGE"
      | "FILE_TYPE_NOT_ALLOWED"
      | "FILE_NOT_FOUND"
      | "FILE_LIMIT_REACHED"
      | "FILE_QUOTA_REACHED"
      | "UPLOAD_EXPIRED"
      | "FILE_SET_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "MessageFileError";
  }
}

type FileClient = PrismaClient | Prisma.TransactionClient;

const fileSelect = {
  id: true,
  eventId: true,
  filename: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  storageKey: true,
  isInlineImage: true,
  createdAt: true,
} as const;

type FileRow = {
  id: string;
  eventId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  isInlineImage: boolean;
  createdAt: Date;
};

export function toMessageFileRecord(row: Pick<FileRow, "id" | "eventId" | "filename" | "contentType" | "sizeBytes" | "isInlineImage" | "createdAt">): MessageFileRecord {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    isInlineImage: row.isInlineImage,
    createdAt: row.createdAt.toISOString(),
    url: messageFileUrl(row.eventId, row.id, row.isInlineImage ? "inline" : "attachment"),
  };
}

/**
 * Stores an upload after checking it is what its bytes say it is. Size comes first (before the bytes are read), then
 * the type is taken from the bytes alone, then the event's room is reserved, the file is written under a generated
 * name, and the row is recorded. A rejected upload leaves nothing behind. `purpose` decides the size ceiling: an
 * image for a message body is held to a small cap, because every recipient downloads it with the message.
 *
 * The event's quota (#845) is counted from what is stored, not from the size a browser declared: the real byte count,
 * in a transaction that holds a per-event lock, together with every other upload's reservation and every file still
 * waiting to be removed from disk. Two uploads racing for the last of the room cannot both fit.
 */
export async function createMessageFile(
  eventId: string,
  file: File,
  actorUserId: string,
  purpose: "attachment" | "inline-image",
  client: PrismaClient = getPrisma(),
): Promise<MessageFileRecord> {
  const limit = purpose === "inline-image" ? MAX_INLINE_IMAGE_BYTES : MAX_MESSAGE_FILE_BYTES;
  if (file.size === 0) {
    throw new MessageFileError("FILE_EMPTY", "That file is empty.");
  }
  if (file.size > limit) {
    throw new MessageFileError(
      "FILE_TOO_LARGE",
      purpose === "inline-image"
        ? `Images in a message must be ${Math.floor(limit / (1024 * 1024))} MB or smaller.`
        : `Each attachment must be ${Math.floor(limit / (1024 * 1024))} MB or smaller.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffMessageFileType(bytes);
  if (!type || (purpose === "inline-image" && !isMessageImageType(type))) {
    throw new MessageFileError(
      "FILE_TYPE_NOT_ALLOWED",
      purpose === "inline-image"
        ? "Upload a PNG, JPEG, or WebP image."
        : "Attach a PDF, PNG, JPEG, WebP, Word, Excel, or PowerPoint file.",
    );
  }
  // The real size, from the bytes read: `file.size` is only what the request claimed.
  const sizeBytes = bytes.byteLength;
  if (sizeBytes === 0 || sizeBytes > limit) {
    throw new MessageFileError("FILE_TOO_LARGE", "That file is not the size it claimed to be.");
  }
  const storageKey = `message-files/${eventId}/${randomUUID()}.${MESSAGE_FILE_TYPES[type].extension}`;

  await reserveUpload(client, eventId, storageKey, sizeBytes);
  try {
    const stored = await writeStoredFileAt(storageKey, bytes);
    const row = await client.$transaction(async (tx) => {
      // Under the event's quota lock, so a reservation check never reads the files and the reservations either side of this commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`message-file-quota:${eventId}`}, 0))`;
      // The reservation goes in the same transaction as the row, so the bytes are never counted twice or not at all.
      // One that is already gone was reconciled as abandoned while this upload was still running.
      const released = await tx.messageFileUploadReservation.deleteMany({ where: { storageKey } });
      if (released.count !== 1) {
        throw new MessageFileError("UPLOAD_EXPIRED", "That upload took too long and was cancelled. Upload the file again.");
      }
      const created = await tx.messageFile.create({
        data: {
          eventId,
          filename: safeMessageFileName(file.name, type),
          contentType: type,
          sizeBytes: stored.byteSize,
          sha256: stored.checksum,
          storageKey: stored.storageKey,
          isInlineImage: purpose === "inline-image",
          uploadedByUserId: actorUserId,
        },
        select: fileSelect,
      });
      await tx.auditLog.create({
        data: {
          eventId,
          actorUserId,
          action: "MESSAGE_FILE_UPLOADED",
          entityType: "MessageFile",
          entityId: created.id,
          correlationId: randomUUID(),
          // Names and sizes only: never the content, its hash, or where it is stored.
          summary: `Uploaded ${purpose === "inline-image" ? "an image for a message" : "a message attachment"}: ${created.filename} (${created.sizeBytes} bytes).`,
          metadata: { files: [{ filename: created.filename, sizeBytes: created.sizeBytes }] },
        },
      });
      return created;
    });
    return toMessageFileRecord(row);
  } catch (error) {
    await abandonUpload(client, eventId, storageKey);
    throw error;
  }
}

/**
 * Checks the event's room and records the claim on it, under a lock that serialises every upload to this event.
 * Throws `FILE_NOT_FOUND`, `FILE_LIMIT_REACHED` or `FILE_QUOTA_REACHED` without writing anything.
 */
async function reserveUpload(client: PrismaClient, eventId: string, storageKey: string, sizeBytes: number) {
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`message-file-quota:${eventId}`}, 0))`;
    // The event must exist (a system administrator can address any id) before a directory is made or a byte is written.
    if (!(await tx.event.findUnique({ where: { id: eventId }, select: { id: true } }))) {
      throw new MessageFileError("FILE_NOT_FOUND", "That event no longer exists.");
    }
    // In this order, one after another: a file deleted without this lock moves to cleanup in one commit, and reading files
    // before cleanup can only count its bytes twice (a cautious refusal), never not at all.
    const files = await tx.messageFile.aggregate({ where: { eventId }, _count: { _all: true }, _sum: { sizeBytes: true } });
    const reserved = await tx.messageFileUploadReservation.aggregate({ where: { eventId }, _count: { _all: true }, _sum: { sizeBytes: true } });
    const cleanup = await tx.messageFileStorageCleanup.aggregate({ where: { eventId }, _sum: { sizeBytes: true } });
    if (files._count._all + reserved._count._all >= MAX_MESSAGE_FILES_PER_EVENT) {
      throw new MessageFileError(
        "FILE_LIMIT_REACHED",
        `This event already holds ${MAX_MESSAGE_FILES_PER_EVENT} message files. Ask a system administrator to clear unused ones.`,
      );
    }
    // Files still waiting to be removed from disk count too: a failed delete has freed nothing.
    const used = (files._sum.sizeBytes ?? 0) + (reserved._sum.sizeBytes ?? 0) + (cleanup._sum.sizeBytes ?? 0);
    if (used + sizeBytes > messageFileEventQuotaBytes()) {
      throw new MessageFileError(
        "FILE_QUOTA_REACHED",
        `This event's message files use ${formatFileSize(used)} of its ${messageFileEventQuotaMb()} MB limit, so this ${formatFileSize(sizeBytes)} file does not fit. Remove attachments you no longer need, or ask a system administrator.`,
      );
    }
    await tx.messageFileUploadReservation.create({
      data: { eventId, storageKey, sizeBytes, expiresAt: new Date(Date.now() + MESSAGE_FILE_RESERVATION_TTL_MS) },
    });
  });
}

/**
 * An upload that failed after reserving room: the bytes go first (best effort), and only when they are gone is the
 * reservation released. If the bytes cannot be removed the reservation stays, still counting their size, and the
 * sweep reconciles it once it has expired. Never throws, so the original error is what the caller sees.
 */
async function abandonUpload(client: PrismaClient, eventId: string, storageKey: string) {
  try {
    await deleteAsset(storageKey);
  } catch (error) {
    logError("An upload's bytes could not be removed after it failed; its reservation was kept for the sweep", error, {
      eventId,
      errorCode: errnoCode(error),
    });
    return;
  }
  try {
    await client.messageFileUploadReservation.deleteMany({ where: { storageKey } });
  } catch (error) {
    logError("An upload's reservation could not be released after it failed; the sweep will reconcile it", error, { eventId });
  }
}

/** The images uploaded for message bodies in this event, newest first, for the editor's picker. */
export async function listInlineImages(eventId: string, client: FileClient = getPrisma()) {
  const rows = await client.messageFile.findMany({
    where: { eventId, isInlineImage: true },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: fileSelect,
  });
  return rows.map(toMessageFileRecord);
}

export async function findMessageFileForStaff(eventId: string, fileId: string, client: FileClient = getPrisma()) {
  return client.messageFile.findFirst({
    where: { id: fileId, eventId },
    select: fileSelect,
  });
}

const TRANSIENT_READ_ERRORS = new Set(["EIO", "EMFILE", "ENFILE", "EAGAIN", "EBUSY", "ETIMEDOUT"]);

/**
 * The bytes of a stored file, checked against the hash recorded at upload. A failure is a typed error with a
 * generic message (never a path): retryable for a transient I/O condition, final for a missing or changed file.
 */
export async function readMessageFileBytes(file: { storageKey: string; sha256: string }) {
  let bytes: Uint8Array;
  try {
    bytes = await readAsset(file.storageKey);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
    if (code === "ENOENT" || code === "ENOTDIR") throw new MessageFileDeliveryError("ATTACHMENT_MISSING", false);
    throw new MessageFileDeliveryError("ATTACHMENT_UNREADABLE", TRANSIENT_READ_ERRORS.has(code));
  }
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new MessageFileDeliveryError("ATTACHMENT_CHANGED", false);
  }
  return bytes;
}

/**
 * Locks the named files of this event `FOR SHARE` until the surrounding transaction ends and returns what it found.
 * Every save that records a reference to a file (a link row, or `msgfile:<id>` in a body, which has no foreign key)
 * validates it through this, in the same transaction that writes the reference. The sweep locks its candidates
 * `FOR UPDATE` and re-reads every reference only after that, so exactly one of two outcomes happens: the save holds
 * the lock, the sweep waits and then sees the committed reference and keeps the file; or the sweep deletes first,
 * and the save finds the file gone and refuses (`FILE_SET_INVALID`) instead of recording a dangling reference.
 * Rows are locked in id order so two saves cannot deadlock each other.
 */
export async function lockMessageFilesForShare(
  client: FileClient,
  eventId: string,
  ids: readonly string[],
  isInlineImage: boolean,
) {
  if (ids.length === 0) return [];
  return client.$queryRaw<Array<{ id: string; sizeBytes: number }>>(Prisma.sql`
    SELECT "id", "sizeBytes" FROM "MessageFile"
    WHERE "id" IN (${Prisma.join([...ids])}) AND "eventId" = ${eventId} AND "isInlineImage" = ${isInlineImage}
    ORDER BY "id"
    FOR SHARE
  `);
}

/**
 * The attachment files an author chose, in the order they chose them, checked to be this event's own downloadable
 * files and to fit the per-message limits together. Throws `FILE_SET_INVALID` otherwise. The files stay locked
 * (`lockMessageFilesForShare`) until the caller's transaction ends.
 */
export async function resolveAttachmentSet(
  client: FileClient,
  eventId: string,
  fileIds: readonly string[],
) {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return [];
  const rows = await lockMessageFilesForShare(client, eventId, unique, false);
  if (rows.length !== unique.length) {
    throw new MessageFileError("FILE_SET_INVALID", "One of the attachments is no longer available. Remove it and attach it again.");
  }
  const issue = attachmentSetIssue(rows);
  if (issue) throw new MessageFileError("FILE_SET_INVALID", issue.message);
  return unique;
}

/**
 * Every uploaded image a body refers to must be one of this event's own inline images, and together they must fit
 * the per-message picture limits, so delivery never has to drop one. The images stay locked until the caller's
 * transaction ends, so run this in the transaction that writes the body.
 */
export async function assertBodyImagesBelongToEvent(
  client: FileClient,
  eventId: string,
  ids: readonly string[],
) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await lockMessageFilesForShare(client, eventId, unique, true);
  if (rows.length !== unique.length) {
    throw new MessageFileError("FILE_SET_INVALID", "An image in the message is no longer available. Remove it and insert it again.");
  }
  const issue = inlineImageSetIssue(rows);
  if (issue) throw new MessageFileError("FILE_SET_INVALID", issue.message);
}

export async function listTemplateVersionFiles(
  client: FileClient,
  versionIds: readonly string[],
) {
  const byVersion = new Map<string, MessageFileRecord[]>();
  if (versionIds.length === 0) return byVersion;
  const rows = await client.messageTemplateVersionFile.findMany({
    where: { templateVersionId: { in: [...versionIds] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { templateVersionId: true, file: { select: fileSelect } },
  });
  for (const row of rows) {
    const list = byVersion.get(row.templateVersionId) ?? [];
    list.push(toMessageFileRecord(row.file));
    byVersion.set(row.templateVersionId, list);
  }
  return byVersion;
}

export async function listAnnouncementFiles(
  client: FileClient,
  announcementIds: readonly string[],
) {
  const byAnnouncement = new Map<string, MessageFileRecord[]>();
  if (announcementIds.length === 0) return byAnnouncement;
  const rows = await client.announcementFile.findMany({
    where: { announcementId: { in: [...announcementIds] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { announcementId: true, file: { select: fileSelect } },
  });
  for (const row of rows) {
    const list = byAnnouncement.get(row.announcementId) ?? [];
    list.push(toMessageFileRecord(row.file));
    byAnnouncement.set(row.announcementId, list);
  }
  return byAnnouncement;
}

/**
 * Whether an announcement, as it will be sent through the event's announcement template, fits the per-message limits:
 * its own files plus the template's attachments, and the pictures in its body (`{{announcement_body}}` is trusted
 * Markdown, so staff can put `![x](msgfile:id)` in it) plus the template's own. Throws `FILE_SET_INVALID` with a
 * message staff can act on, so a send can never fail on something the save let through.
 */
export async function assertAnnouncementFits(
  tx: FileClient,
  eventId: string,
  input: { body: string; fileIds: readonly string[] },
) {
  const bodyPictureIds = messageFileIdsInMarkdown(input.body);
  if (input.fileIds.length === 0 && bodyPictureIds.length === 0) return;
  const published = await tx.messageTemplateVersion.findFirst({
    where: { template: { eventId, key: "EVENT_ANNOUNCEMENT" }, status: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    select: { bodyTemplate: true, files: { select: { fileId: true } } },
  });
  if (input.fileIds.length > 0) {
    await resolveAttachmentSet(tx, eventId, [...input.fileIds, ...(published?.files.map((row) => row.fileId) ?? [])]);
  }
  await assertBodyImagesBelongToEvent(tx, eventId, [
    ...bodyPictureIds,
    ...(published ? messageFileIdsInMarkdown(published.bodyTemplate) : []),
  ]);
}

/** Replaces an announcement's attachments with exactly `fileIds`. */
export async function setAnnouncementFiles(
  tx: Prisma.TransactionClient,
  eventId: string,
  announcementId: string,
  fileIds: readonly string[],
) {
  const ids = await resolveAttachmentSet(tx, eventId, fileIds);
  await tx.announcementFile.deleteMany({ where: { announcementId } });
  if (ids.length > 0) {
    await tx.announcementFile.createMany({
      data: ids.map((fileId, position) => ({ announcementId, fileId, position })),
    });
  }
  return ids;
}

/** Replaces a template version's attachments with exactly `fileIds`. */
export async function setTemplateVersionFiles(
  tx: Prisma.TransactionClient,
  eventId: string,
  templateVersionId: string,
  fileIds: readonly string[],
) {
  const ids = await resolveAttachmentSet(tx, eventId, fileIds);
  if (ids.length > 0) {
    await tx.messageTemplateVersionFile.createMany({
      data: ids.map((fileId, position) => ({ templateVersionId, fileId, position })),
    });
  }
  return ids;
}

/**
 * The attachment ids of a template's newest published version, for carrying forward into the next one.
 */
export async function latestPublishedVersionFileIds(client: FileClient, templateId: string) {
  const rows = await client.messageTemplateVersionFile.findMany({
    where: { templateVersion: { templateId, status: "PUBLISHED" } },
    orderBy: [{ templateVersion: { versionNumber: "desc" } }, { position: "asc" }],
    select: { fileId: true, templateVersion: { select: { versionNumber: true } } },
  });
  if (rows.length === 0) return [];
  const newest = rows[0].templateVersion.versionNumber;
  return rows.filter((row) => row.templateVersion.versionNumber === newest).map((row) => row.fileId);
}

/** What the audit trail may say about files: names and sizes. */
export async function describeFilesForAudit(client: FileClient, fileIds: readonly string[]) {
  if (fileIds.length === 0) return [];
  const rows = await client.messageFile.findMany({
    where: { id: { in: [...fileIds] } },
    select: { filename: true, sizeBytes: true },
  });
  return rows.map((row) => ({ filename: row.filename, sizeBytes: row.sizeBytes }));
}

/**
 * Writes the durable references from queued outbox rows to the files they send: the attachments of their template
 * version, any `extraAttachmentFileIds` (an announcement's own), and every uploaded image their rendered HTML embeds.
 * The delivery worker reads only these rows, so every attempt, retry and resend sends the same files.
 *
 * Reads what it needs from the rows themselves, so every place that queues messages calls it the same way, once
 * per batch, with the ids it just created.
 */
export async function linkQueuedMessageFiles(
  tx: FileClient,
  input: {
    eventId: string;
    messageIds: readonly string[];
    extraAttachmentFileIds?: readonly string[];
  },
) {
  if (input.messageIds.length === 0) return;
  const messages = await tx.messageOutbox.findMany({
    where: { id: { in: [...input.messageIds] }, eventId: input.eventId },
    select: { id: true, templateVersionId: true, bodyHtmlSnapshot: true },
  });
  const versionIds = [...new Set(messages.flatMap((message) => message.templateVersionId ? [message.templateVersionId] : []))];
  const versionFiles = versionIds.length > 0
    ? await tx.messageTemplateVersionFile.findMany({
        where: { templateVersionId: { in: versionIds } },
        orderBy: { position: "asc" },
        select: { templateVersionId: true, fileId: true },
      })
    : [];
  const idsByVersion = new Map<string, string[]>();
  for (const row of versionFiles) {
    idsByVersion.set(row.templateVersionId, [...(idsByVersion.get(row.templateVersionId) ?? []), row.fileId]);
  }

  const imageIdsByMessage = new Map<string, string[]>();
  const allImageIds = new Set<string>();
  for (const message of messages) {
    const ids = message.bodyHtmlSnapshot ? messageFileIdsInHtml(message.bodyHtmlSnapshot) : [];
    if (ids.length > 0) {
      imageIdsByMessage.set(message.id, ids);
      ids.forEach((id) => allImageIds.add(id));
    }
  }
  // Only this event's own inline images are ever linked, whatever a body claims, and one that fails the check is an
  // error: a message is never queued with a picture it could not send.
  const imageRows = allImageIds.size > 0
    ? await tx.messageFile.findMany({
        where: { id: { in: [...allImageIds] }, eventId: input.eventId, isInlineImage: true },
        select: { id: true, sizeBytes: true },
      })
    : [];
  if (imageRows.length !== allImageIds.size) {
    throw new MessageFileError("FILE_SET_INVALID", "A picture in the message is not one of this event's uploaded images, so the message was not queued.");
  }
  const imageSize = new Map(imageRows.map((row) => [row.id, row.sizeBytes]));
  const allAttachmentIds = [...new Set([...(input.extraAttachmentFileIds ?? []), ...versionFiles.map((row) => row.fileId)])];
  const attachmentRows = allAttachmentIds.length > 0
    ? await tx.messageFile.findMany({ where: { id: { in: allAttachmentIds }, eventId: input.eventId }, select: { id: true, sizeBytes: true } })
    : [];
  if (attachmentRows.length !== allAttachmentIds.length) {
    throw new MessageFileError("FILE_SET_INVALID", "A file attached to this message is no longer available, so the message was not queued.");
  }
  const attachmentSize = new Map(attachmentRows.map((row) => [row.id, row.sizeBytes]));

  const data: Prisma.MessageOutboxFileCreateManyInput[] = [];
  for (const message of messages) {
    // An announcement's own files first, then the template version's.
    const attachmentIds = [...new Set([
      ...(input.extraAttachmentFileIds ?? []),
      ...(message.templateVersionId ? idsByVersion.get(message.templateVersionId) ?? [] : []),
    ])];
    // The limits are checked here too, so a test message or a late edit can never queue a set delivery would refuse.
    const attachmentIssue = attachmentSetIssue(attachmentIds.map((id) => ({ sizeBytes: attachmentSize.get(id) ?? 0 })));
    if (attachmentIssue) throw new MessageFileError("FILE_SET_INVALID", attachmentIssue.message);
    const messageImages = imageIdsByMessage.get(message.id) ?? [];
    const imageIssue = inlineImageSetIssue(messageImages.map((id) => ({ sizeBytes: imageSize.get(id) ?? 0 })));
    if (imageIssue) throw new MessageFileError("FILE_SET_INVALID", imageIssue.message);
    attachmentIds.forEach((fileId, position) => {
      data.push({ messageOutboxId: message.id, fileId, disposition: "ATTACHMENT", position });
    });
    messageImages.forEach((fileId, position) => {
      data.push({ messageOutboxId: message.id, fileId, disposition: "INLINE", position });
    });
  }
  if (data.length > 0) await tx.messageOutboxFile.createMany({ data, skipDuplicates: true });
}

/** The attachment files linked to an announcement's own row, for the send. */
export async function announcementAttachmentIds(client: FileClient, announcementId: string) {
  const rows = await client.announcementFile.findMany({
    where: { announcementId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { fileId: true },
  });
  return rows.map((row) => row.fileId);
}

/** Copies one outbox row's file references to another (a staff retry or resend of the same message). */
export async function copyOutboxFiles(tx: FileClient, fromMessageId: string, toMessageId: string) {
  const rows = await tx.messageOutboxFile.findMany({
    where: { messageOutboxId: fromMessageId },
    select: { fileId: true, disposition: true, position: true },
  });
  if (rows.length === 0) return;
  await tx.messageOutboxFile.createMany({
    data: rows.map((row) => ({ ...row, messageOutboxId: toMessageId })),
    skipDuplicates: true,
  });
}

/**
 * Removes a file nothing refers to any more, from the table and then from disk. Safe to call on a file still in use:
 * it locks the row, re-checks every reference (links, and `msgfile:` in any body or snapshot, in any event), and keeps
 * the file if there is one. This is a person's own request for one file, so it does not wait for the sweep's grace period.
 * The row delete and a cleanup record for the bytes commit together; the bytes are deleted after, and if that fails the
 * record stays for the sweep to retry (and keeps counting against the event's quota).
 */
export async function deleteMessageFileIfUnused(eventId: string, fileId: string, client: PrismaClient = getPrisma()) {
  let cleanup: { id: string; eventId: string; storageKey: string; sizeBytes: number } | null;
  try {
    cleanup = await client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; storageKey: string; sizeBytes: number }>>(Prisma.sql`
        SELECT "id", "storageKey", "sizeBytes" FROM "MessageFile"
        WHERE "id" = ${fileId} AND "eventId" = ${eventId}
        FOR UPDATE
      `);
      const file = locked[0];
      if (!file) return null;
      if ((await findReferencedMessageFileIds(tx, [file.id])).size > 0) return null;
      const removed = await tx.messageFile.deleteMany({ where: { id: file.id } });
      if (removed.count === 0) return null;
      return tx.messageFileStorageCleanup.upsert({
        where: { storageKey: file.storageKey },
        create: { eventId, storageKey: file.storageKey, sizeBytes: file.sizeBytes, reason: "REMOVED" },
        update: {},
        select: { id: true, eventId: true, storageKey: true, sizeBytes: true },
      });
    }, SWEEP_TRANSACTION_OPTIONS);
  } catch (error) {
    // The foreign keys are RESTRICT: if anything linked the file after the check, the database refuses the delete
    // (a foreign key violation) and the file stays. Any other failure (a timeout, a lost connection) is not "in use".
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return false;
    throw error;
  }
  if (!cleanup) return false;
  await removeStoredBytes(client, [cleanup], new Date());
  return true;
}
