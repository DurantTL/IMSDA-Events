import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { escapeHtml, withPlainLeadNote } from "@/modules/communications/email-html";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { enqueueRegistrationUpdatedMessage } from "@/modules/communications/transactional-messages";
import { isNotificationEnabled } from "@/modules/notifications/settings";
import { notifyFormNotificationsAfterChange } from "@/modules/registration-form-notifications/after-commit";
import { ensureRegistrationPdfOutsideTransaction } from "@/modules/registration-pdf/repository";
import { REGISTRANT_UPDATED_PDF_NOTE, queueStaffUpdatedRegistrationCopies } from "@/modules/registration-pdf/notices";

/**
 * Making and attaching the registration PDF AFTER the registration's transaction has committed (#1082).
 *
 * The PDF is slow work, and a failure to make it must never fail a registration, so it is never built inside the gated
 * submit transaction or the amendment transaction (docs/MEALS.md). Those transactions queue their messages held
 * (`hold.ts`); the functions here then build the PDF, attach it to the held rows, release them and send. Everything is
 * caught: on any failure the held messages are released and go without the PDF, and only ids are logged.
 */

const CONFIRMATION_NOTE = "A PDF copy of your registration is attached.";

/**
 * Adds one plain line to a rendered message. When the message already starts with a plain lead note (the club
 * confirmation note, #931) the new line joins that paragraph after it ("Club note. A PDF copy ... is attached."), so the
 * club note stays first; otherwise it leads the message.
 */
function withNoteAfterLeadNote(rendered: { body: string; bodyHtml: string }, note: string) {
  const firstBreak = rendered.body.indexOf("\n\n");
  const firstParagraph = firstBreak === -1 ? rendered.body : rendered.body.slice(0, firstBreak);
  // A lead note is one plain line; a template starts with a heading or a greeting line instead.
  const startsWithLeadNote = firstBreak !== -1 && !/^(#|\*|-|>|!|\[|Hello|Hi\b|Dear)/.test(firstParagraph) && !firstParagraph.includes("\n");
  if (!startsWithLeadNote) return withPlainLeadNote(rendered, note);
  return {
    body: `${firstParagraph} ${note}${rendered.body.slice(firstBreak)}`,
    // The html of that one paragraph, with the line added inside it.
    bodyHtml: rendered.bodyHtml.replace(/<\/p>/, ` ${escapeHtml(note)}</p>`),
  };
}

async function attachToMessages(messageIds: readonly string[], attachmentId: string, registrantNote: string) {
  if (messageIds.length === 0) return;
  const prisma = getPrisma();
  const rows = await prisma.messageOutbox.findMany({
    where: { id: { in: [...messageIds] }, status: "PENDING" },
    select: { id: true, recipientKind: true, bodyTextSnapshot: true, bodyHtmlSnapshot: true },
  });
  for (const row of rows) {
    // The line saying a PDF is attached goes only into the registrant's message, and only now that the file exists. It
    // follows the club note (the message's first plain line), so the note stays first.
    const shown = row.recipientKind === "REGISTRANT"
      ? withNoteAfterLeadNote({ body: row.bodyTextSnapshot, bodyHtml: row.bodyHtmlSnapshot ?? "" }, registrantNote)
      : { body: row.bodyTextSnapshot, bodyHtml: row.bodyHtmlSnapshot ?? "" };
    await prisma.messageOutbox.update({
      where: { id: row.id },
      data: { attachmentId, bodyTextSnapshot: shown.body, bodyHtmlSnapshot: row.bodyHtmlSnapshot === null ? null : shown.bodyHtml },
    });
  }
}

/** Makes held messages claimable again (the PDF is attached, or will not be). Never throws. */
async function releaseHold(messageIds: readonly string[], context: { registrationId: string }) {
  if (messageIds.length === 0) return;
  try {
    const now = new Date();
    await getPrisma().messageOutbox.updateMany({
      where: { id: { in: [...messageIds] }, status: "PENDING", availableAt: { gt: now } },
      data: { availableAt: now },
    });
  } catch (error) {
    // The hold runs out by itself within minutes, and the sweep then sends the message without the PDF.
    logError("Held registration messages could not be released.", error, { registrationId: context.registrationId, messageCount: messageIds.length });
  }
}

/**
 * Submit: attaches the registration's PDF (version 1) to the held confirmation and staff copy, releases them, and
 * leaves the sending to the caller. A failure of any kind releases them without the PDF.
 */
export async function attachRegistrationPdfAfterCommit(input: { eventId: string; registrationId: string; messageIds: readonly string[] }) {
  if (input.messageIds.length === 0) return;
  try {
    const ensured = await ensureRegistrationPdfOutsideTransaction({ eventId: input.eventId, registrationId: input.registrationId });
    if (ensured) await attachToMessages(input.messageIds, ensured.document.attachmentId, CONFIRMATION_NOTE);
  } catch (error) {
    logError("The registration PDF could not be made; the confirmation goes without it.", error, { registrationId: input.registrationId });
  } finally {
    await releaseHold(input.messageIds, input);
  }
}

/**
 * A change to a registration made by a director or staff (an amendment, an added attendee, a substitution): makes the
 * next PDF version when what it says changed, marks it Updated, and sends it. The registrant gets the "Registration
 * updated" email with it (the one an amendment already queued held, else a new one) and the staff copy is re-sent marked
 * Updated. Sends only when the change was meaningful or an earlier version exists (a registration made before PDFs, with
 * a no-op save, sends nothing). Sends everything it queued before it returns, and never throws.
 */
export async function finishRegistrationChange(input: {
  eventId: string;
  registrationId: string;
  /** Names this change, so a retry queues the same messages (the amendment's id). */
  changeKey: string;
  correlationId: string;
  /** The change is one the registrant is told about whatever the PDF says. */
  meaningful: boolean;
  /** The registrant's "Registration updated" message the transaction queued held, if it queued one. */
  heldMessageIds?: readonly string[];
}) {
  const held = [...(input.heldMessageIds ?? [])];
  const toProcess = [...held];
  try {
    const ensured = await ensureRegistrationPdfOutsideTransaction({
      eventId: input.eventId,
      registrationId: input.registrationId,
      notifiedChange: { meaningful: input.meaningful },
    });
    const pdf = ensured?.created ? ensured.document : null;
    if (ensured && pdf && (ensured.previousVersion !== null || input.meaningful)) {
      await attachToMessages(held, pdf.attachmentId, REGISTRANT_UPDATED_PDF_NOTE);
      // Outside any transaction (the settings read), then one small transaction for the new messages.
      const staffCopyEnabled = await isNotificationEnabled("NEW_REGISTRATION_STAFF_COPY");
      const queued = await getPrisma().$transaction(async (tx) => {
        const ids: string[] = [];
        if (held.length === 0) {
          const registrant = await enqueueRegistrationUpdatedMessage(tx, {
            eventId: input.eventId,
            registrationId: input.registrationId,
            correlationId: input.correlationId,
            transitionKey: `registration-change:${input.changeKey}`,
            changeCategory: "REGISTRATION_DETAILS",
            attachmentId: pdf.attachmentId,
            leadNote: REGISTRANT_UPDATED_PDF_NOTE,
          });
          ids.push(...registrant.pendingMessageIds);
        }
        const staff = await queueStaffUpdatedRegistrationCopies(tx, {
          eventId: input.eventId,
          registrationId: input.registrationId,
          attachmentId: pdf.attachmentId,
          changeKey: `registration-change:${input.changeKey}`,
          correlationId: input.correlationId,
          staffCopyEnabled,
        });
        ids.push(...staff.pendingMessageIds);
        return ids;
      });
      toProcess.push(...queued);
    }
  } catch (error) {
    logError("The updated registration PDF could not be made or queued; the change itself is saved.", error, { registrationId: input.registrationId });
  } finally {
    await releaseHold(held, input);
    try {
      await processQueuedMessageIdsAfterCommit(toProcess);
    } catch (error) {
      logError("Updated registration messages could not be delivered right now; they stay queued.", error, { registrationId: input.registrationId });
    }
  }
  // The form's own notifications (#1081): each one whose included sections changed, and the new location's. Never throws.
  await notifyFormNotificationsAfterChange({
    eventId: input.eventId,
    registrationId: input.registrationId,
    changeKey: input.changeKey,
    correlationId: input.correlationId,
  });
}

export { CONFIRMATION_NOTE as REGISTRATION_PDF_CONFIRMATION_NOTE };
