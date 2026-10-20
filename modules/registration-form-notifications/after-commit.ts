import "server-only";

import { createHash } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { logError, logWarn } from "@/lib/logger";
import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { suppressionNote } from "@/modules/communications/delivery-hold";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { isNotificationEnabled } from "@/modules/notifications/settings";
import {
  REGISTRATION_PDF_MAX_BYTES,
  buildRegistrationPdfModel,
  registrationPdfContentHash,
  registrationPdfFilename,
  type RegistrationPdfModel,
} from "@/modules/registration-pdf/model";
import { renderRegistrationPdf } from "@/modules/registration-pdf/render";
import { ensureRegistrationPdfOutsideTransaction, loadRegistrationPdfSource } from "@/modules/registration-pdf/repository";
import {
  conditionStillAllowed,
  effectiveSectionIds,
  includesText,
  notificationApplies,
  sectionSignature,
} from "@/modules/registration-form-notifications/domain";
import {
  conditionOf,
  notificationMessageKey,
  queueNotificationMessages,
  renderNotificationEmail,
  sectionTitlesOf,
  type QueuedFormNotificationGroup,
} from "@/modules/registration-form-notifications/queue";

/**
 * Making and attaching the PDFs of registration form notifications AFTER the registration's transaction has committed
 * (#1081), the same pattern as the registration PDF (`modules/registration-pdf/after-commit.ts`):
 *
 * - Submit: the transaction queued the matching messages HELD (`queueFormNotificationsForSubmission`). Here each
 *   notification's PDF, filtered to its included sections, is built and attached, and the hold is released.
 * - Change (a director's or staff's amendment, an added attendee, a substitution): after the commit, each notification
 *   whose condition now matches and whose INCLUDED sections changed since it last sent is sent again, marked Updated.
 *   A notification that matches now but never sent for this registration (a location change to another site) is sent
 *   as a first notification.
 *
 * Nothing here ever fails a registration: everything is caught, only ids are logged, and a held message is always
 * released (without its PDF when the PDF could not be made). Never call these inside a transaction.
 */
/**
 * What a notification's copy says, for telling whether "something in its included sections changed". It is the model's
 * content with the header (event, form, registrant, club, dates, location) left out, so a location change or a renamed
 * club does not re-send a notification whose sections did not change. Payments and the card fee are already ignored.
 */
export function notificationContentHash(model: RegistrationPdfModel) {
  return registrationPdfContentHash({
    ...model,
    eventName: "",
    eventDates: "",
    eventLocation: "",
    formTitle: "",
    clubName: null,
    teamName: null,
    registrantName: "",
    submittedOn: null,
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadRegistrationPdfSource>>>;

/** One model, hash and attachment per distinct set of sections in a run: notifications with the same sections share them. */
type RunCache = Map<string, { model: RegistrationPdfModel; hash: string; attachments: Map<boolean, string | null> }>;

function modelFor(loaded: Loaded, sectionIds: readonly string[], cache: RunCache) {
  const signature = sectionSignature(sectionIds);
  let entry = cache.get(signature);
  if (!entry) {
    const model = buildRegistrationPdfModel(loaded.source, { sectionIds });
    entry = { model, hash: notificationContentHash(model), attachments: new Map() };
    cache.set(signature, entry);
  }
  return entry;
}

/**
 * The attachment for a notification: the registration PDF itself (#1082, already stored) when it includes every section, else
 * one filtered PDF stored once per distinct set of sections and Updated mark in this run. Null when it cannot be made.
 */
async function attachmentFor(input: {
  eventId: string;
  registrationId: string;
  loaded: Loaded;
  sectionIds: readonly string[];
  updated: boolean;
  notificationName: string;
  cache: RunCache;
}) {
  const entry = modelFor(input.loaded, input.sectionIds, input.cache);
  if (entry.attachments.has(input.updated)) return entry.attachments.get(input.updated) ?? null;
  let attachmentId: string | null;
  if (input.sectionIds.length === 0) {
    const ensured = await ensureRegistrationPdfOutsideTransaction({ eventId: input.eventId, registrationId: input.registrationId });
    attachmentId = ensured?.document.attachmentId ?? null;
  } else {
    attachmentId = await storeNotificationPdf({
      eventId: input.eventId,
      loaded: input.loaded,
      model: entry.model,
      updated: input.updated,
      notificationName: input.notificationName,
      filtered: true,
    });
  }
  entry.attachments.set(input.updated, attachmentId);
  return attachmentId;
}

function nameSlug(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

/** Renders and stores one notification's PDF as a `MessageAttachment`; null when it is over the email size cap. */
async function storeNotificationPdf(input: {
  eventId: string;
  loaded: Loaded;
  model: RegistrationPdfModel;
  updated: boolean;
  notificationName: string;
  filtered: boolean;
}) {
  const bytes = await renderRegistrationPdf({ model: input.model, updated: input.updated, generatedAt: new Date(), timezone: input.loaded.timezone });
  if (bytes.byteLength > REGISTRATION_PDF_MAX_BYTES) {
    logWarn("A notification PDF was over the email size limit and was not attached.", { eventId: input.eventId, sizeBytes: bytes.byteLength });
    return null;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base = registrationPdfFilename({ eventName: input.loaded.eventName, clubName: input.loaded.clubName, registrantName: input.loaded.registrantName, updated: input.updated });
  const slug = input.filtered ? nameSlug(input.notificationName) : "";
  const filename = slug ? base.replace(/(-UPDATED)?\.pdf$/, `-${slug}$1.pdf`) : base;
  const attachment = await getPrisma().messageAttachment.create({
    data: { eventId: input.eventId, filename, contentType: "application/pdf", sizeBytes: bytes.byteLength, sha256, content: Buffer.from(bytes) },
    select: { id: true },
  });
  return attachment.id;
}

async function registrationFacts(eventId: string, registrationId: string) {
  return getPrisma().registration.findFirst({
    where: { id: registrationId, eventId },
    select: {
      status: true,
      locationId: true,
      submittedAt: true,
      location: { select: { name: true } },
      publicFormSubmission: { select: { formVersion: { select: { formId: true } } } },
    },
  });
}

async function recordDelivery(input: { notificationId: string; registrationId: string; contentHash: string; signature: string; sent: boolean }) {
  const now = new Date();
  await getPrisma().registrationNotificationDelivery.upsert({
    where: { notificationId_registrationId: { notificationId: input.notificationId, registrationId: input.registrationId } },
    create: { notificationId: input.notificationId, registrationId: input.registrationId, contentHash: input.contentHash, sectionSignature: input.signature, lastSentAt: now },
    update: {
      contentHash: input.contentHash,
      sectionSignature: input.signature,
      ...(input.sent ? { sendCount: { increment: 1 }, lastSentAt: now } : {}),
    },
  });
}

/** Makes held messages claimable again. Never throws; the hold also runs out by itself within minutes. */
async function releaseHold(messageIds: readonly string[], registrationId: string) {
  if (messageIds.length === 0) return;
  try {
    const now = new Date();
    await getPrisma().messageOutbox.updateMany({
      where: { id: { in: [...messageIds] }, status: "PENDING", availableAt: { gt: now } },
      data: { availableAt: now },
    });
  } catch (error) {
    logError("Held form notification messages could not be released.", error, { registrationId, messageCount: messageIds.length });
  }
}

/**
 * Submit: builds each queued notification's filtered PDF, attaches it to that notification's held messages and records
 * what was sent (the baseline for a later change), then releases the hold. Leaves the sending to the caller. A failure for
 * one notification does not touch the others; a held message always goes, with the PDF or, failing that, without it.
 */
export async function finishFormNotificationsAfterSubmit(input: { eventId: string; registrationId: string; groups: readonly QueuedFormNotificationGroup[] }) {
  const messageIds = input.groups.flatMap((group) => group.messageIds);
  if (messageIds.length === 0) return;
  try {
    const prisma = getPrisma();
    const [loaded, rows, facts] = await Promise.all([
      loadRegistrationPdfSource(prisma, input.eventId, input.registrationId),
      prisma.registrationFormNotification.findMany({ where: { id: { in: input.groups.map((group) => group.notificationId) } } }),
      registrationFacts(input.eventId, input.registrationId),
    ]);
    if (loaded) {
      const cache: RunCache = new Map();
      const titles = sectionTitlesOf(loaded.source.definition);
      for (const group of input.groups) {
        try {
          const row = rows.find((candidate) => candidate.id === group.notificationId);
          if (!row) continue;
          // Chosen sections missing from the version this registration is on: the full registration, not an empty PDF.
          const sectionIds = effectiveSectionIds(loaded.source.definition, row.sectionIds);
          const { hash } = modelFor(loaded, sectionIds, cache);
          // The people are being told now, whether or not the PDF can be made, so this is the baseline either way.
          await recordDelivery({ notificationId: row.id, registrationId: input.registrationId, contentHash: hash, signature: sectionSignature(sectionIds), sent: false });
          const attachmentId = await attachmentFor({ eventId: input.eventId, registrationId: input.registrationId, loaded, sectionIds, updated: false, notificationName: row.name, cache });
          if (!attachmentId) continue;
          const content = renderNotificationEmail({
            notificationName: row.name,
            eventName: loaded.eventName,
            formTitle: loaded.source.formTitle,
            registrantName: loaded.registrantName,
            locationName: facts?.location?.name ?? null,
            includes: includesText(sectionIds, titles),
            updated: false,
            hasPdf: true,
          });
          await prisma.messageOutbox.updateMany({
            where: { id: { in: group.messageIds }, status: "PENDING" },
            data: { attachmentId, subjectSnapshot: content.subject, bodyTextSnapshot: content.bodyText, bodyHtmlSnapshot: content.bodyHtml },
          });
        } catch (error) {
          logError("A notification PDF could not be made; its message goes without it.", error, { registrationId: input.registrationId, notificationId: group.notificationId });
        }
      }
    }
  } catch (error) {
    logError("Form notification PDFs could not be made; the messages go without them.", error, { registrationId: input.registrationId });
  } finally {
    await releaseHold(messageIds, input.registrationId);
  }
}

/**
 * A change to a registration, after it committed: sends again each notification whose condition matches NOW and whose
 * included sections changed since it last sent (marked Updated, with the new filtered PDF). A notification that matches
 * but has not sent for this registration yet is sent as a first notification, which is how a location change reaches the
 * new location's people; one that stopped matching sends nothing. Reads the switch first, outside any transaction. A
 * paused event records suppressed messages and does not advance what was "sent". Never throws.
 */
export async function notifyFormNotificationsAfterChange(input: { eventId: string; registrationId: string; changeKey: string; correlationId: string }) {
  const toProcess: string[] = [];
  try {
    const enabled = await isNotificationEnabled("REGISTRATION_FORM_NOTIFICATIONS");
    if (!enabled) return;
    const prisma = getPrisma();
    const facts = await registrationFacts(input.eventId, input.registrationId);
    const formId = facts?.publicFormSubmission?.formVersion.formId;
    // A waitlisted registration was never announced, so a change to it announces nothing.
    if (!facts || !formId || facts.status === "WAITLISTED") return;
    const rows = await prisma.registrationFormNotification.findMany({
      where: { formId },
      orderBy: { position: "asc" },
      include: { deliveries: { where: { registrationId: input.registrationId } } },
    });
    if (rows.length === 0) return;
    const loaded = await loadRegistrationPdfSource(prisma, input.eventId, input.registrationId);
    if (!loaded) return;
    const answers = loaded.source.registrationResponses;
    const titles = sectionTitlesOf(loaded.source.definition);
    const cache: RunCache = new Map();
    // Read once, outside any transaction: a paused event stores no PDFs at all.
    const eventSettings = await loadEventEmailSettings(prisma, input.eventId);
    const paused = suppressionNote(eventSettings) !== null;
    for (const row of rows) {
      try {
        if (row.recipients.length === 0) continue;
        if (!conditionStillAllowed(loaded.source.definition, row)) {
          // The form changed since the condition was saved; skipped, never sent unconditioned. Id only.
          logWarn("A form notification was skipped: its condition looks at a question that is no longer allowed.", { notificationId: row.id });
          continue;
        }
        if (!notificationApplies(conditionOf(row), answers, facts.locationId)) continue;
        const sectionIds = effectiveSectionIds(loaded.source.definition, row.sectionIds);
        const { hash } = modelFor(loaded, sectionIds, cache);
        const signature = sectionSignature(sectionIds);
        const delivery = row.deliveries[0];
        let updated: boolean;
        if (!delivery) {
          // Made after this registration: it was never owed this notification, so a later edit does not start one.
          if (facts.submittedAt && row.createdAt > facts.submittedAt) continue;
          updated = false;
        } else if (delivery.sectionSignature !== signature) {
          // Its sections were edited since: start a new baseline rather than calling the next send an update.
          await recordDelivery({ notificationId: row.id, registrationId: input.registrationId, contentHash: hash, signature, sent: false });
          continue;
        } else if (delivery.contentHash === hash) {
          continue;
        } else {
          updated = true;
        }
        // A retry of the same change finds its rows: nothing is rendered or stored again.
        const keys = row.recipients.map((email) => notificationMessageKey(row.id, input.registrationId, input.changeKey, email));
        const already = await prisma.messageOutbox.findMany({ where: { idempotencyKey: { in: keys } }, select: { id: true } });
        if (already.length === keys.length) {
          if (!paused) await recordDelivery({ notificationId: row.id, registrationId: input.registrationId, contentHash: hash, signature, sent: false });
          continue;
        }
        // A paused event records suppressed rows with no PDF.
        const attachmentId = paused
          ? null
          : await attachmentFor({ eventId: input.eventId, registrationId: input.registrationId, loaded, sectionIds, updated, notificationName: row.name, cache });
        const content = renderNotificationEmail({
          notificationName: row.name,
          eventName: loaded.eventName,
          formTitle: loaded.source.formTitle,
          registrantName: loaded.registrantName,
          locationName: facts.location?.name ?? null,
          includes: includesText(sectionIds, titles),
          updated,
          hasPdf: attachmentId !== null,
        });
        // Outside any transaction until now; one small one for the messages.
        const queued = await prisma.$transaction(async (tx) => {
          const settings = await loadEventEmailSettings(tx, input.eventId);
          if (!settings) throw new Error("The event's email settings could not be read.");
          return queueNotificationMessages(tx, {
            eventId: input.eventId,
            registrationId: input.registrationId,
            correlationId: input.correlationId,
            keyScope: input.changeKey,
            notification: row,
            content,
            attachmentId,
            hold: false,
          }, settings);
        });
        toProcess.push(...queued.pendingMessageIds);
        // Nothing left (a paused event): the people were not told, so the baseline stays and a later change tells them.
        if (!queued.suppressed && queued.created > 0) {
          await recordDelivery({ notificationId: row.id, registrationId: input.registrationId, contentHash: hash, signature, sent: true });
        }
      } catch (error) {
        logError("A form notification could not be queued after a registration change.", error, { registrationId: input.registrationId, notificationId: row.id });
      }
    }
  } catch (error) {
    logError("Form notifications could not be sent after a registration change; the change itself is saved.", error, { registrationId: input.registrationId });
  } finally {
    try {
      await processQueuedMessageIdsAfterCommit(toProcess);
    } catch (error) {
      logError("Form notification messages could not be delivered right now; they stay queued.", error, { registrationId: input.registrationId });
    }
  }
}
