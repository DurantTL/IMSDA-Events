/**
 * Proves the message file sweep and the per-event storage quota (#845) against a real PostgreSQL database and a
 * temporary storage directory (no network, fictitious rows):
 *
 * - a dry run reports what it would remove and removes nothing; only an apply run deletes, rows first, bytes after;
 * - a file younger than the grace period is never touched, and a requested grace under 24 hours is raised to 24;
 * - a file linked to an old or archived template version, a picture named only in a template body (no foreign key), an
 *   announcement body, a scheduled batch body or an outbox snapshot, and a file linked by an announcement, are never deleted;
 * - a save that holds its files locked makes the sweep wait and then keep them; a sweep that deleted first makes the
 *   save refuse (FILE_SET_INVALID) instead of recording a reference to nothing;
 * - a disk failure leaves a retryable cleanup record that still counts toward the quota, and a later run clears it;
 * - an expired upload reservation is reconciled;
 * - concurrent uploads at the edge of the quota: exactly as many succeed as fit, none over, and no reservation is left.
 *
 *   npm run test:message-file-sweep
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-message-file-sweep-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("MANAGE_LINK_DERIVATION_SECRET", "verify-message-file-sweep-synthetic-derivation-secret-01");
fillBlankSyntheticEnv("ATTENDEE_PASS_SIGNING_SECRET", "verify-message-file-sweep-synthetic-pass-signing-secret-01");
fillBlankSyntheticEnv("APP_BASE_URL", "http://localhost:3000");
// A small quota so the edge is reachable with small files. Set before the app reads its environment.
process.env.MESSAGE_FILE_EVENT_QUOTA_MB = "5";
process.env.MESSAGE_FILE_SWEEP_GRACE_HOURS = "72";
delete process.env.MESSAGE_FILE_SWEEP_DELETE;

const prisma = new PrismaClient();
const P = `mf845_${randomUUID().slice(0, 8)}`;
const ids = { staff: `${P}_staff`, event: `${P}_event`, quotaEvent: `${P}_quota` };
const MB = 1024 * 1024;
const HOUR = 3_600_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function pdfOf(label: string, size = 600) {
  const head = Buffer.from(`%PDF-1.7\n% ${label}\n`);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x20)]);
}

function pngOf(label: string, size = 200) {
  const head = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
}

const asFile = (bytes: Buffer, name: string) => new File([new Uint8Array(bytes)], name);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  const inEvents = { eventId: { in: [ids.event, ids.quotaEvent] } };
  await prisma.auditLog.deleteMany({ where: { OR: [inEvents, { actorUserId: ids.staff }] } });
  await prisma.messageOutbox.deleteMany({ where: inEvents });
  await prisma.scheduledEmailBatch.deleteMany({ where: inEvents });
  await prisma.announcement.deleteMany({ where: inEvents });
  await prisma.eventMessageTemplate.deleteMany({ where: inEvents });
  await prisma.messageFile.deleteMany({ where: inEvents });
  await prisma.messageFileUploadReservation.deleteMany({ where: inEvents });
  await prisma.messageFileStorageCleanup.deleteMany({ where: inEvents });
  await prisma.event.deleteMany({ where: { id: { in: [ids.event, ids.quotaEvent] } } });
  await prisma.user.deleteMany({ where: { id: ids.staff } });
}

async function exists(storageDir: string, key: string) {
  return access(path.join(storageDir, key)).then(() => true, () => false);
}

async function main() {
  const storageDir = await mkdtemp(path.join(tmpdir(), "imsda-message-file-sweep-"));
  process.env.ASSET_STORAGE_DIR = storageDir;
  try {
    await runChecks(storageDir);
  } finally {
    await rm(storageDir, { recursive: true, force: true });
  }
}

async function runChecks(storageDir: string) {
  const { createMessageFile, assertBodyImagesBelongToEvent, MessageFileError, deleteMessageFileIfUnused } = await import("@/modules/communications/message-files");
  const { sweepMessageFiles } = await import("@/modules/communications/message-file-sweep");
  const { createAnnouncement } = await import("@/modules/communications/repository");
  const { ensureEventMessagingDefaults, publishMessageTemplateVersion } = await import("@/modules/communications/messaging-repository");

  await cleanup();
  await prisma.user.create({ data: { id: ids.staff, email: `${P}.staff@example.test`, displayName: "Synthetic Staff" } });
  for (const [eventId, name] of [[ids.event, "Sweep Verification Retreat"], [ids.quotaEvent, "Quota Verification Retreat"]] as const) {
    await prisma.event.create({
      data: { id: eventId, slug: `${eventId}-slug`, name, startsAt: new Date("2027-10-08T21:00:00Z"), endsAt: new Date("2027-10-10T17:00:00Z"), location: "Synthetic Camp" },
    });
  }
  await ensureEventMessagingDefaults(ids.event);
  const template = await prisma.eventMessageTemplate.findUniqueOrThrow({
    where: { eventId_key: { eventId: ids.event, key: "EVENT_ANNOUNCEMENT" } },
    select: { id: true },
  });

  const upload = (bytes: Buffer, name: string, purpose: "attachment" | "inline-image" = "attachment", eventId = ids.event) =>
    createMessageFile(eventId, asFile(bytes, name), ids.staff, purpose, prisma);
  const keyOf = async (id: string) => (await prisma.messageFile.findUniqueOrThrow({ where: { id }, select: { storageKey: true } })).storageKey;
  const backdate = (fileIds: string[], hours: number) =>
    prisma.messageFile.updateMany({ where: { id: { in: fileIds } }, data: { createdAt: new Date(Date.now() - hours * HOUR) } });
  const present = async (id: string) => (await prisma.messageFile.count({ where: { id } })) === 1;

  // --- Files: some orphaned, some referenced in every way a file can be. ----------------------------------------
  const orphan = await upload(pdfOf("orphan"), "Orphan.pdf");
  const young = await upload(pdfOf("young"), "Young.pdf");
  const thirtyHours = await upload(pdfOf("thirty"), "Thirty.pdf");
  const archivedVersionFile = await upload(pdfOf("archived"), "Archived.pdf");
  const bodyPicture = await upload(pngOf("body"), "body.png", "inline-image");
  const archivedBodyPicture = await upload(pngOf("old-body"), "old-body.png", "inline-image");
  const announcementPicture = await upload(pngOf("announcement"), "ann.png", "inline-image");
  const announcementAttachment = await upload(pdfOf("announcement-attachment"), "Ann.pdf");
  const batchPicture = await upload(pngOf("batch"), "batch.png", "inline-image");
  const snapshotPicture = await upload(pngOf("snapshot"), "snap.png", "inline-image");

  const bodyWith = (...pictureIds: string[]) => ["# {{announcement_title}}", "", "{{announcement_body}}", "", ...pictureIds.map((id) => `![Picture](msgfile:${id})`)].join("\n");
  const publish = (text: string, attachmentFileIds?: string[]) => publishMessageTemplateVersion(ids.event, template.id, {
    subjectTemplate: "{{event_name}}: {{announcement_title}}", bodyTemplate: text, isEnabled: true, ...(attachmentFileIds ? { attachmentFileIds } : {}),
  }, ids.staff);
  // Version 1 (later archived) carries one attachment and one picture; version 2 carries a different picture and no attachment.
  await publish(bodyWith(archivedBodyPicture.id), [archivedVersionFile.id]);
  await publish(bodyWith(bodyPicture.id), []);
  assert((await prisma.messageTemplateVersion.count({ where: { templateId: template.id, status: "ARCHIVED" } })) >= 2, "the earlier versions are archived");
  await createAnnouncement(ids.event, ids.staff, {
    title: "Synthetic news", body: `Hello ![x](msgfile:${announcementPicture.id})`, priority: "NORMAL", attachmentFileIds: [announcementAttachment.id],
  });
  await prisma.scheduledEmailBatch.create({
    data: {
      id: `${P}_batch`, eventId: ids.event, name: "Synthetic batch", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "T",
      announcementBody: `Body ![x](msgfile:${batchPicture.id})`, trigger: "ONE_TIME", localDate: "2027-09-01", localTime: "09:00", eventTimezone: "America/Chicago",
      sendAt: new Date("2027-09-01T14:00:00Z"), audienceQuery: {}, audienceQueryVersion: "1", audienceQueryHash: "h", audienceFingerprint: "f", createdByUserId: ids.staff,
    },
  });
  await prisma.messageOutbox.create({
    data: {
      eventId: ids.event, templateKey: "EVENT_ANNOUNCEMENT", recipientKind: "REGISTRANT", recipientEmail: `${P}@example.test`,
      senderNameSnapshot: "Synthetic", subjectSnapshot: "Subject", bodyTextSnapshot: "Text", bodyHtmlSnapshot: `<p><img src="msgfile:${snapshotPicture.id}" alt="x"></p>`,
      idempotencyKey: `${P}-outbox`, correlationId: randomUUID(),
    },
  });
  await backdate([orphan.id, thirtyHours.id, archivedVersionFile.id, bodyPicture.id, archivedBodyPicture.id, announcementPicture.id, announcementAttachment.id, batchPicture.id, snapshotPicture.id], 100);
  await backdate([thirtyHours.id], 30);
  const orphanKey = await keyOf(orphan.id);

  // --- 1. Dry run: reports, changes nothing. ---------------------------------------------------------------------
  const dry = await sweepMessageFiles({ mode: "dry-run" });
  assert(dry.mode === "dry-run", "the default mode is a dry run");
  const wouldDelete = dry.wouldDelete.filter((file) => file.eventId === ids.event).map((file) => file.id);
  assert(wouldDelete.length === 1 && wouldDelete[0] === orphan.id, `a dry run names only the abandoned old file (got ${wouldDelete.join(",")})`);
  assert(!JSON.stringify(dry).includes(orphanKey), "the report holds no storage key");
  assert((await present(orphan.id)) && (await exists(storageDir, orphanKey)), "a dry run deletes nothing");
  assert((await prisma.auditLog.count({ where: { eventId: ids.event, action: "MESSAGE_FILES_SWEPT" } })) === 0, "a dry run writes no audit row");

  // --- 2. The 24 hour floor and the grace period. ----------------------------------------------------------------
  const floored = await sweepMessageFiles({ mode: "dry-run", graceHours: 1 });
  assert(floored.graceHours === 24, "a grace period under 24 hours is raised to 24");
  const flooredIds = floored.wouldDelete.filter((file) => file.eventId === ids.event).map((file) => file.id).sort();
  assert(flooredIds.includes(thirtyHours.id) && !flooredIds.includes(young.id), "a 30 hour old file is a candidate at 24 hours, a brand new one is not");

  // --- 3. Apply: the orphan goes (row, then bytes); everything referenced stays, on disk too. ---------------------
  const applied = await sweepMessageFiles({ mode: "apply" });
  assert(applied.deleted.count >= 1 && !(await present(orphan.id)), "apply deletes the orphan's row");
  assert(!(await exists(storageDir, orphanKey)), "and its bytes after the commit");
  assert((await prisma.messageFileStorageCleanup.count({ where: { eventId: ids.event } })) === 0, "no cleanup record is left once the bytes are gone");
  for (const [label, file] of [
    ["a file young enough to be inside the grace period", young], ["a 30 hour old file inside the 72 hour grace period", thirtyHours],
    ["an attachment linked to an archived template version", archivedVersionFile], ["a picture named only in the current template body", bodyPicture],
    ["a picture named only in an archived template body", archivedBodyPicture], ["a picture named only in an announcement body", announcementPicture],
    ["an announcement attachment", announcementAttachment], ["a picture named only in a scheduled batch body", batchPicture],
    ["a picture named only in an outbox snapshot", snapshotPicture],
  ] as const) {
    assert(await present(file.id), `${label} is kept`);
    assert(await exists(storageDir, await keyOf(file.id)), `${label} keeps its bytes`);
  }
  assert((await prisma.auditLog.count({ where: { eventId: ids.event, action: "MESSAGE_FILES_SWEPT" } })) === 1, "one audit row records the sweep");
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: ids.event, action: "MESSAGE_FILES_SWEPT" } });
  assert(!JSON.stringify(audit).includes("message-files/") && !JSON.stringify(audit).includes("Orphan"), "and holds counts and sizes only");

  // --- 4. Staff removing one file goes through the same recheck. --------------------------------------------------
  assert(!(await deleteMessageFileIfUnused(ids.event, bodyPicture.id, prisma)), "staff cannot remove a picture a template body names");
  assert(!(await deleteMessageFileIfUnused(ids.event, announcementAttachment.id, prisma)), "or an announcement's attachment");
  assert(await deleteMessageFileIfUnused(ids.event, young.id, prisma), "but can remove an unused file, even a young one");

  // --- 5. A save holding its files locked: the sweep waits, then keeps them. ---------------------------------------
  const racing = await upload(pngOf("racing"), "racing.png", "inline-image");
  await backdate([racing.id], 100);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const lockedSignal = new Promise<void>((resolve) => { locked = resolve; });
  const save = prisma.$transaction(async (tx) => {
    await tx.announcement.create({
      data: { eventId: ids.event, createdByUserId: ids.staff, title: "Racing", body: `![x](msgfile:${racing.id})`, audience: { type: "ALL_ATTENDEES" }, placement: "HOME_BANNER", status: "DRAFT" },
    });
    await assertBodyImagesBelongToEvent(tx, ids.event, [racing.id]);
    locked();
    await held;
  }, { timeout: 30_000 });
  await lockedSignal;
  const sweeping = sweepMessageFiles({ mode: "apply" });
  await sleep(1500);
  release();
  await save;
  const raced = await sweeping;
  assert(await present(racing.id) && await exists(storageDir, await keyOf(racing.id)), "a picture a save is naming survives a sweep that started during the save");
  assert(raced.keptAtRecheck >= 1, "the locked recheck is what kept it");

  // --- 6. A sweep that deleted first: the save refuses rather than record a reference to nothing. ----------------
  const doomed = await upload(pngOf("doomed"), "doomed.png", "inline-image");
  let releaseSweep!: () => void;
  const sweepHeld = new Promise<void>((resolve) => { releaseSweep = resolve; });
  let sweepLocked!: () => void;
  const sweepLockedSignal = new Promise<void>((resolve) => { sweepLocked = resolve; });
  const fakeSweep = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MessageFile" WHERE "id" = ${doomed.id} FOR UPDATE`;
    await tx.messageFile.delete({ where: { id: doomed.id } });
    sweepLocked();
    await sweepHeld;
  }, { timeout: 30_000 });
  await sweepLockedSignal;
  const refusedSave = prisma.$transaction((tx) => assertBodyImagesBelongToEvent(tx, ids.event, [doomed.id]), { timeout: 30_000 })
    .then(() => null, (error: unknown) => error);
  await sleep(800);
  releaseSweep();
  await fakeSweep;
  const refusal = await refusedSave;
  assert(refusal instanceof MessageFileError && refusal.code === "FILE_SET_INVALID", "a save that waited for the sweep's delete is refused with FILE_SET_INVALID");

  // --- 7. A disk failure leaves a retryable record that still counts toward the quota. -----------------------------
  const stuck = await upload(pdfOf("stuck", 4000), "Stuck.pdf");
  await backdate([stuck.id], 100);
  const stuckKey = await keyOf(stuck.id);
  // A directory where the file was makes unlink fail with a real error that is not "not found".
  await rm(path.join(storageDir, stuckKey));
  await mkdir(path.join(storageDir, stuckKey));
  const failed = await sweepMessageFiles({ mode: "apply" });
  assert(failed.cleanup.failed >= 1, "the failed disk delete is reported");
  const record = await prisma.messageFileStorageCleanup.findFirstOrThrow({ where: { eventId: ids.event } });
  assert(record.attempts === 1 && record.lastErrorCode !== null && record.sizeBytes === 4000 && record.reason === "SWEEP", "a cleanup record keeps the attempt, the error code and the size");
  assert(!(await present(stuck.id)), "the row is gone");
  const { getMessageFileStorageUsage } = await import("@/modules/communications/message-file-usage");
  const usage = (await getMessageFileStorageUsage()).events.find((event) => event.eventId === ids.event);
  assert(usage !== undefined && usage.pendingCleanupBytes === 4000, "the usage view counts the bytes still on disk");
  await rm(path.join(storageDir, stuckKey), { recursive: true });
  const retried = await sweepMessageFiles({ mode: "apply", now: new Date(Date.now() + 2 * HOUR) });
  assert(retried.cleanup.succeeded >= 1 && (await prisma.messageFileStorageCleanup.count({ where: { eventId: ids.event } })) === 0, "a later run clears the record");

  // --- 8. An expired reservation is reconciled; one still running is left. ------------------------------------------
  const abandonedKey = `message-files/${ids.event}/${randomUUID()}.pdf`;
  await mkdir(path.join(storageDir, `message-files/${ids.event}`), { recursive: true });
  await (await import("node:fs/promises")).writeFile(path.join(storageDir, abandonedKey), pdfOf("abandoned"));
  await prisma.messageFileUploadReservation.createMany({
    data: [
      { eventId: ids.event, storageKey: abandonedKey, sizeBytes: 600, expiresAt: new Date(Date.now() - HOUR) },
      { eventId: ids.event, storageKey: `message-files/${ids.event}/${randomUUID()}.pdf`, sizeBytes: 600, expiresAt: new Date(Date.now() + HOUR) },
    ],
  });
  await sweepMessageFiles({ mode: "apply" });
  assert(!(await exists(storageDir, abandonedKey)), "an abandoned upload's bytes are removed");
  assert((await prisma.messageFileUploadReservation.count({ where: { eventId: ids.event } })) === 1, "only the expired reservation is released");

  // --- 9. The quota: concurrent uploads at the edge. 5 MB limit; three 2 MB uploads race, two fit. ---------------------
  const results = await Promise.allSettled([1, 2, 3].map((index) => upload(pdfOf(`edge-${index}`, 2 * MB), `Edge${index}.pdf`, "attachment", ids.quotaEvent)));
  const ok = results.filter((result) => result.status === "fulfilled").length;
  const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(ok === 2 && refused.length === 1, `exactly two of three 2 MB uploads fit in 5 MB (got ${ok})`);
  assert(refused[0].reason instanceof MessageFileError && refused[0].reason.code === "FILE_QUOTA_REACHED", "the third is refused for the quota");
  assert(/of its 5 MB limit/.test(refused[0].reason.message), "with the honest message");
  assert((await prisma.messageFileUploadReservation.count({ where: { eventId: ids.quotaEvent } })) === 0, "no reservation is left behind");
  assert((await prisma.messageFile.aggregate({ where: { eventId: ids.quotaEvent }, _sum: { sizeBytes: true } }))._sum.sizeBytes === 4 * MB, "the stored bytes are exactly what fit");
  const rows = await prisma.messageFile.findMany({ where: { eventId: ids.quotaEvent }, select: { storageKey: true } });
  for (const row of rows) assert(await exists(storageDir, row.storageKey), "each stored file is on disk");

  console.log("message file sweep verification passed");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error: unknown) => {
      console.error("cleanup failed", error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
