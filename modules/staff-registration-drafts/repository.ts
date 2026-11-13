import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, RegistrationFormStatus } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { hashOpaqueToken } from "@/modules/access/tokens";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { AccountEmailNotConfiguredError, getAccountEmailSender } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { evaluateEventRegistrationPhase } from "@/modules/events/lifecycle";
import { isFieldVisible, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { hydrateFormOptions } from "@/modules/forms/form-options-repository";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";
import { checkPublicRegistration, PublicRegistrationError, type PublicRegistrationCheck } from "@/modules/forms/public-repository";
import { StaffDraftError } from "@/modules/staff-registration-drafts/errors";
import {
  sanitizeStaffDraftResponses,
  staffDraftCheckLines,
  staffDraftContact,
  staffDraftLinkExpiry,
  staffDraftPlan,
  STAFF_DRAFT_FORM_CHANGED,
  type StaffDraftCheckLines,
  type StaffDraftSource,
  type StaffDraftStatus,
} from "@/modules/staff-registration-drafts/domain";
import {
  STAFF_DRAFT_LINK_TEMPLATE_KEY,
  staffDraftLinkEmailContent,
} from "@/modules/staff-registration-drafts/link-email";
import type { CreateStaffDraftInput, UpdateStaffDraftInput } from "@/modules/staff-registration-drafts/schemas";

type Client = Prisma.TransactionClient;

const draftSelect = {
  id: true,
  eventId: true,
  formId: true,
  formVersionId: true,
  source: true,
  status: true,
  responses: true,
  handOffExpiresAt: true,
  handedOffAt: true,
  handOffMessageId: true,
  registrationId: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
  handedOffBy: { select: { displayName: true } },
  form: { select: { name: true, slug: true } },
  formVersion: { select: { definition: true } },
} satisfies Prisma.StaffRegistrationDraftSelect;

type DraftRow = Prisma.StaffRegistrationDraftGetPayload<{ select: typeof draftSelect }>;

function responsesFromJson(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sameAnswers(left: Record<string, unknown>, right: Record<string, unknown>) {
  const canonical = (value: Record<string, unknown>) => JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
  return canonical(left) === canonical(right);
}

function toSummary(row: DraftRow) {
  const definition = registrationFormDefinitionSchema.parse(row.formVersion.definition);
  const contact = staffDraftContact(definition, responsesFromJson(row.responses));
  return {
    id: row.id,
    formId: row.formId,
    formName: row.form.name,
    source: row.source as StaffDraftSource,
    status: row.status as StaffDraftStatus,
    registrantName: contact.name,
    registrantEmail: contact.email,
    createdByName: row.createdBy.displayName,
    updatedByName: row.updatedBy.displayName,
    handedOffByName: row.handedOffBy?.displayName ?? null,
    handOffExpiresAt: row.handOffExpiresAt?.toISOString() ?? null,
    handedOffAt: row.handedOffAt?.toISOString() ?? null,
    registrationId: row.registrationId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type StaffDraftSummary = ReturnType<typeof toSummary>;

async function publishedFormForEvent(client: Pick<Client, "registrationForm">, eventId: string, formId: string) {
  const form = await client.registrationForm.findFirst({
    where: { id: formId, eventId },
    select: {
      id: true,
      name: true,
      slug: true,
      event: { select: { id: true, slug: true, name: true, audience: true, isPublished: true, archivedAt: true, attendeeTypes: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } } },
      versions: {
        where: { status: RegistrationFormStatus.PUBLISHED },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, definition: true },
      },
    },
  });
  if (!form) throw new StaffDraftError("FORM_NOT_FOUND", "That form could not be found for this event.");
  // A club event takes registrations through the club portal and the event's general link, never an individual draft.
  if (form.event.audience === "CLUB") throw new StaffDraftError("CLUB_EVENT", "Phone and paper registrations are for events open to individuals, not club events.");
  const version = form.versions[0];
  if (!version || !form.event.isPublished || form.event.archivedAt) {
    throw new StaffDraftError("FORM_NOT_AVAILABLE", "Only a published form on a published event can be used.");
  }
  return { form, event: form.event, version, definition: registrationFormDefinitionSchema.parse(version.definition) };
}

async function auditDraft(client: Pick<Client, "auditLog">, input: { eventId: string; actorUserId: string; action: string; draftId: string; summary: string; metadata?: Prisma.InputJsonObject }) {
  // Counts, ids and states only. An answer is never written here.
  await client.auditLog.create({
    data: {
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: "StaffRegistrationDraft",
      entityId: input.draftId,
      correlationId: randomUUID(),
      summary: input.summary,
      metadata: { paymentCollected: false, ...(input.metadata ?? {}) },
    },
  });
}

async function lockDraft(tx: Client, eventId: string, draftId: string) {
  await tx.$queryRaw`SELECT "id" FROM "StaffRegistrationDraft" WHERE "id" = ${draftId} AND "eventId" = ${eventId} FOR UPDATE`;
  const row = await tx.staffRegistrationDraft.findFirst({ where: { id: draftId, eventId }, select: draftSelect });
  if (!row) throw new StaffDraftError("DRAFT_NOT_FOUND", "That draft could not be found.");
  return row;
}

/** Cancels a link email that has not gone out yet, so an old message can never revive a withdrawn link. */
async function cancelPendingLinkMessage(tx: Client, messageId: string | null) {
  if (!messageId) return;
  await tx.messageOutbox.updateMany({ where: { id: messageId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

export async function listStaffDrafts(eventId: string) {
  const rows = await getPrisma().staffRegistrationDraft.findMany({
    where: { eventId, status: { not: "DISCARDED" } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: draftSelect,
  });
  return rows.map(toSummary);
}

/** The individual forms staff can start a draft on: published, on a published event that is not for clubs. */
export async function listStartableForms(eventId: string) {
  const forms = await getPrisma().registrationForm.findMany({
    where: {
      eventId,
      event: { audience: { not: "CLUB" }, isPublished: true, archivedAt: null },
      versions: { some: { status: RegistrationFormStatus.PUBLISHED } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return forms;
}

/** One draft, with the form it is pinned to (options filled in) and what staff may type, for the editor. */
export async function getStaffDraft(eventId: string, draftId: string) {
  const prisma = getPrisma();
  const row = await prisma.staffRegistrationDraft.findFirst({ where: { id: draftId, eventId }, select: draftSelect });
  if (!row) throw new StaffDraftError("DRAFT_NOT_FOUND", "That draft could not be found.");
  const current = await publishedFormForEvent(prisma, eventId, row.formId).catch(() => null);
  // Edited against the form as published now: a saved draft is moved to it, so what staff see is what the registrant gets.
  const definitionSource = current?.definition ?? registrationFormDefinitionSchema.parse(row.formVersion.definition);
  const definition = await hydrateFormOptions(definitionSource, { attendeeTypes: current?.event.attendeeTypes });
  const plan = staffDraftPlan(definition);
  return {
    draft: toSummary(row),
    responses: row.status === "SUBMITTED" || row.status === "DISCARDED" ? {} : sanitizeStaffDraftResponses(definition, responsesFromJson(row.responses)),
    definition,
    plan: { rosterEnabled: plan.rosterEnabled, sections: plan.sections },
    /** True when the form was published again after the draft was started. Save moves the draft to the new version; Check waits for that. */
    formChanged: Boolean(current && current.version.id !== row.formVersionId),
  };
}

export async function createStaffDraft(eventId: string, actorUserId: string, input: CreateStaffDraftInput) {
  const prisma = getPrisma();
  const { form, version, definition } = await publishedFormForEvent(prisma, eventId, input.formId);
  const responses = sanitizeStaffDraftResponses(definition, input.responses ?? {});
  return prisma.$transaction(async (tx) => {
    const created = await tx.staffRegistrationDraft.create({
      data: {
        eventId,
        formId: form.id,
        formVersionId: version.id,
        source: input.source,
        responses: responses as Prisma.InputJsonObject,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
      select: { id: true },
    });
    await auditDraft(tx, {
      eventId,
      actorUserId,
      action: "STAFF_REGISTRATION_DRAFT_CREATED",
      draftId: created.id,
      summary: "Started a registration for someone (phone, paper or walk-in).",
      metadata: { source: input.source, formId: form.id, formVersionId: version.id, answerCount: Object.keys(responses).length },
    });
    return { id: created.id };
  });
}

export async function updateStaffDraft(eventId: string, draftId: string, actorUserId: string, input: UpdateStaffDraftInput) {
  const prisma = getPrisma();
  const existing = await prisma.staffRegistrationDraft.findFirst({ where: { id: draftId, eventId }, select: { formId: true } });
  if (!existing) throw new StaffDraftError("DRAFT_NOT_FOUND", "That draft could not be found.");
  const { version, definition } = await publishedFormForEvent(prisma, eventId, existing.formId);
  const responses = sanitizeStaffDraftResponses(definition, input.responses);
  return prisma.$transaction(async (tx) => {
    const row = await lockDraft(tx, eventId, draftId);
    if (row.status !== "OPEN" && row.status !== "HANDED_OFF") {
      throw new StaffDraftError("DRAFT_NOT_EDITABLE", "This registration was already sent or discarded, so it can't be changed.");
    }
    // Only a real change withdraws the link the registrant already has: the cleaned answers or the source differ from what is stored.
    const stored = sanitizeStaffDraftResponses(definition, responsesFromJson(row.responses));
    const changed = !sameAnswers(stored, responses) || Boolean(input.source && input.source !== row.source);
    const linkRevoked = row.status === "HANDED_OFF" && changed;
    if (!changed && row.formVersionId === version.id) return { id: draftId, linkRevoked: false, changed: false };
    if (linkRevoked) await cancelPendingLinkMessage(tx, row.handOffMessageId);
    await tx.staffRegistrationDraft.update({
      where: { id: draftId },
      data: {
        responses: responses as Prisma.InputJsonObject,
        formVersionId: version.id,
        updatedByUserId: actorUserId,
        ...(input.source ? { source: input.source } : {}),
        // Changing a draft already sent withdraws its link: the registrant would otherwise open answers that have changed.
        ...(linkRevoked ? { status: "OPEN", handOffTokenHash: null, handOffExpiresAt: null, handOffMessageId: null } : {}),
      },
    });
    await auditDraft(tx, {
      eventId,
      actorUserId,
      action: "STAFF_REGISTRATION_DRAFT_UPDATED",
      draftId,
      summary: linkRevoked ? "Changed a registration that had been sent; its private link was withdrawn." : "Changed a registration staff started.",
      metadata: { formVersionId: version.id, answerCount: Object.keys(responses).length, linkRevoked, movedToNewVersion: row.formVersionId !== version.id },
    });
    return { id: draftId, linkRevoked, changed };
  });
}

export async function discardStaffDraft(eventId: string, draftId: string, actorUserId: string) {
  return getPrisma().$transaction(async (tx) => {
    const row = await lockDraft(tx, eventId, draftId);
    if (row.status === "SUBMITTED") throw new StaffDraftError("DRAFT_NOT_EDITABLE", "This registration was already sent, so it can't be discarded.");
    if (row.status === "DISCARDED") return { id: draftId };
    await cancelPendingLinkMessage(tx, row.handOffMessageId);
    await tx.staffRegistrationDraft.update({
      where: { id: draftId },
      data: {
        status: "DISCARDED",
        discardedAt: new Date(),
        responses: {},
        handOffTokenHash: null,
        handOffExpiresAt: null,
        handOffMessageId: null,
        updatedByUserId: actorUserId,
      },
    });
    await auditDraft(tx, { eventId, actorUserId, action: "STAFF_REGISTRATION_DRAFT_DISCARDED", draftId, summary: "Discarded a registration staff started." });
    return { id: draftId };
  });
}

export type StaffDraftCheckResult =
  /** An estimate: answers only the registrant gives (a birth date, a payment choice) can change the price. `registrantFills` names the required ones. */
  | { ok: true; check: PublicRegistrationCheck; registrantFills: string[] }
  | { ok: false; kind: "NEEDS_ANSWERS"; message: string; lines: StaffDraftCheckLines; /** A roster form is priced only once the registrant adds the people. */ rosterPending: boolean }
  | { ok: false; kind: "UNAVAILABLE"; message: string };

/**
 * Runs the public form's own submit on the draft and keeps nothing: validation, price windows, promo codes, capacity and
 * the waitlist decision, rolled back at the end (`checkPublicRegistration`). A random idempotency key is used each time,
 * and the draft's pinned form version, so a form that was published again since is refused.
 */
export async function checkStaffDraft(eventId: string, draftId: string, actorUserId: string): Promise<StaffDraftCheckResult> {
  const prisma = getPrisma();
  const row = await prisma.staffRegistrationDraft.findFirst({ where: { id: draftId, eventId }, select: draftSelect });
  if (!row) throw new StaffDraftError("DRAFT_NOT_FOUND", "That draft could not be found.");
  if (row.status !== "OPEN" && row.status !== "HANDED_OFF") {
    throw new StaffDraftError("DRAFT_NOT_EDITABLE", "This registration was already sent or discarded, so it can't be checked.");
  }
  const { form, event, version, definition } = await publishedFormForEvent(prisma, eventId, row.formId);
  if (version.id !== row.formVersionId) throw new StaffDraftError("FORM_CHANGED", STAFF_DRAFT_FORM_CHANGED);
  const pinned = await hydrateFormOptions(definition, { attendeeTypes: event.attendeeTypes });
  const roster = staffDraftPlan(pinned).rosterEnabled;
  const input = publicRegistrationInputSchema.parse({
    versionId: row.formVersionId,
    idempotencyKey: randomUUID(),
    responses: sanitizeStaffDraftResponses(definition, responsesFromJson(row.responses)),
    ...(roster ? { attendees: [] } : {}),
  });
  let outcome: StaffDraftCheckResult;
  try {
    const registrantFills = staffDraftPlan(pinned).sections
      .flatMap((section) => section.fields)
      .filter((entry) => !entry.editable && entry.field.required && isFieldVisible(entry.field, input.responses))
      .map((entry) => entry.field.label);
    outcome = { ok: true, check: await checkPublicRegistration(event.slug, form.slug, input), registrantFills };
  } catch (error) {
    if (!(error instanceof PublicRegistrationError)) throw error;
    outcome = error.code === "INVALID_SUBMISSION" || error.code === "CAPACITY_REACHED"
      ? { ok: false, kind: "NEEDS_ANSWERS", message: error.message, lines: staffDraftCheckLines(error.issues, pinned), rosterPending: roster }
      : { ok: false, kind: "UNAVAILABLE", message: error.message };
  }
  await auditDraft(prisma, {
    eventId,
    actorUserId,
    action: "STAFF_REGISTRATION_DRAFT_CHECKED",
    draftId,
    summary: "Checked a registration staff started with the public form's rules. Nothing was saved.",
    metadata: {
      ok: outcome.ok,
      ...(outcome.ok
        ? { registrationStatus: outcome.check.registrationStatus }
        : outcome.kind === "NEEDS_ANSWERS"
          ? { needsCount: outcome.lines.staffNeeds.length, registrantCount: outcome.lines.registrantFills.length }
          : {}),
    },
  });
  return outcome;
}

/**
 * Sends the registrant ONE email with a private link to finish the registration. One draft per call. "Send again" is the
 * same call on a draft already sent: the earlier link stops working at once and the new one replaces it when it is delivered.
 */
export async function handOffStaffDraft(eventId: string, draftId: string, actorUserId: string, now = new Date()) {
  let sender;
  try {
    sender = getAccountEmailSender();
  } catch (error) {
    if (error instanceof AccountEmailNotConfiguredError) {
      throw new StaffDraftError("EMAIL_NOT_CONFIGURED", "Email isn't set up on this site, so the link can't be sent yet. Ask a system administrator.");
    }
    throw error;
  }
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const row = await lockDraft(tx, eventId, draftId);
    if (row.status !== "OPEN" && row.status !== "HANDED_OFF") {
      throw new StaffDraftError("DRAFT_NOT_EDITABLE", "This registration was already sent or discarded, so it can't be sent again.");
    }
    const { event } = await publishedFormForEvent(tx, eventId, row.formId);
    const fullEvent = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    if (evaluateEventRegistrationPhase(fullEvent, now) !== "OPEN") {
      throw new StaffDraftError("REGISTRATION_NOT_OPEN", "Registration for this event isn't open, so the registrant couldn't finish it.");
    }
    const definition = registrationFormDefinitionSchema.parse(row.formVersion.definition);
    const contact = staffDraftContact(definition, sanitizeStaffDraftResponses(definition, responsesFromJson(row.responses)));
    if (!contact.email || !contact.name) {
      throw new StaffDraftError("EMAIL_REQUIRED", "Add the registrant's first name, last name and email before sending the link.");
    }
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorUserId }, select: { displayName: true } });
    const expiresAt = staffDraftLinkExpiry(now);
    const content = staffDraftLinkEmailContent({
      staffName: actor.displayName,
      eventName: event.name,
      expiresOn: formatInConferenceTime(expiresAt, { month: "long", day: "numeric", year: "numeric" }),
    });
    await cancelPendingLinkMessage(tx, row.handOffMessageId);
    const message = await tx.messageOutbox.create({
      data: {
        eventId: null,
        templateKey: STAFF_DRAFT_LINK_TEMPLATE_KEY,
        recipientKind: "ACCOUNT",
        recipientEmail: contact.email,
        recipientName: null,
        senderNameSnapshot: sender.name,
        senderEmailSnapshot: sender.address,
        replyToEmailSnapshot: sender.replyTo,
        subjectSnapshot: content.subject,
        bodyTextSnapshot: content.bodyText,
        metadata: { trigger: STAFF_DRAFT_LINK_TEMPLATE_KEY, accountEmail: true, realDelivery: true, staffRegistrationDraftId: draftId },
        idempotencyKey: `staff-registration-draft-link:${draftId}:${randomUUID()}`,
        correlationId: randomUUID(),
        status: "PENDING",
      },
      select: { id: true },
    });
    await tx.staffRegistrationDraft.update({
      where: { id: draftId },
      data: {
        status: "HANDED_OFF",
        // The old link stops now; the new token is made when this message is delivered and only its hash is stored.
        handOffTokenHash: null,
        handOffExpiresAt: expiresAt,
        handedOffAt: now,
        handedOffByUserId: actorUserId,
        handOffMessageId: message.id,
        updatedByUserId: actorUserId,
      },
    });
    await auditDraft(tx, {
      eventId,
      actorUserId,
      action: "STAFF_REGISTRATION_DRAFT_HANDED_OFF",
      draftId,
      summary: row.status === "HANDED_OFF" ? "Sent the registrant a new private link." : "Sent the registrant a private link to finish the registration.",
      metadata: { messageId: message.id, resend: row.status === "HANDED_OFF", expiresAt: expiresAt.toISOString() },
    });
    return { messageId: message.id, expiresAt, email: contact.email };
  });
  // Best effort, after commit: a failure leaves the message queued, and the outbox sweep delivers it.
  try {
    await processAccountEmailQueue({ messageIds: [result.messageId], limit: 1 });
  } catch (error) {
    logError("A staff-started registration link could not be delivered right away.", error, { messageId: result.messageId });
  }
  return { expiresAt: result.expiresAt.toISOString() };
}

/** What the registrant's page needs, or null when the link is unknown, used, withdrawn or expired (the page never says which). */
export async function resolveStaffDraftLink(token: string, now = new Date()) {
  if (!token || token.length > 100) return null;
  const prisma = getPrisma();
  const draft = await prisma.staffRegistrationDraft.findUnique({
    where: { handOffTokenHash: hashOpaqueToken(token) },
    select: {
      id: true,
      eventId: true,
      status: true,
      handOffExpiresAt: true,
      responses: true,
      form: { select: { slug: true } },
      event: { select: { slug: true } },
    },
  });
  if (!draft || draft.status !== "HANDED_OFF" || !draft.handOffExpiresAt || draft.handOffExpiresAt <= now) return null;
  return {
    draftId: draft.id,
    eventSlug: draft.event.slug,
    formSlug: draft.form.slug,
    responses: responsesFromJson(draft.responses),
  };
}

/** The saved answers kept only for questions the form asks now (and may hold), for prefilling the public form. */
export function prefillFromStaffDraft(definition: RegistrationFormDefinition, responses: Record<string, unknown>) {
  return sanitizeStaffDraftResponses(definition, responses);
}
