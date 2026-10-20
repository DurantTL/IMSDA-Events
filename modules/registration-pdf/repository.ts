import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { formatMessageDateRange } from "@/modules/communications/templates";
import { NO_TEAM_KEY } from "@/modules/club-teams/domain";
import { currentPricingSnapshot, perPersonPriceFromSnapshot } from "@/modules/club-registrations/per-person-price";
import { getAttendeeRosterConfig, registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  CARD_PROCESSING_LABEL,
  REGISTRATION_PDF_GENERATOR_VERSION,
  REGISTRATION_PDF_MAX_BYTES,
  buildRegistrationPdfModel,
  churchBilledFees,
  registrationPdfContentHash,
  registrationPdfFilename,
  type RegistrationPdfFees,
  type RegistrationPdfSource,
} from "@/modules/registration-pdf/model";
import { renderRegistrationPdf } from "@/modules/registration-pdf/render";

/**
 * The registration PDF (#1082): made from the saved answers and the published form version the registration is on,
 * stored once per version as a `MessageAttachment` (the same row the invoice PDF uses, so the outbox attaches it and the
 * hash is checked again at send), and served from those stored bytes.
 *
 * A version is added only when what the PDF says changes (`contentHash`); version 1 is the original copy and every later
 * one is marked "Updated". Nothing here sends mail: the submit and amendment paths queue the messages with the
 * attachment this returns, so the decision to send (a paused event, the staff-copy switch) stays in the messaging code.
 */

type Client = Prisma.TransactionClient | PrismaClient;

const registrationSelect = {
  id: true,
  eventId: true,
  totalAmount: true,
  submittedAt: true,
  contactSnapshot: true,
  accountHolderPerson: { select: { firstName: true, lastName: true } },
  event: { select: { name: true, startsAt: true, endsAt: true, timezone: true, location: true, billingMode: true } },
  location: { select: { name: true, address: true } },
  publicFormSubmission: { select: { formVersionId: true, responses: true, pricingSnapshot: true, formVersion: { select: { definition: true } } } },
  operations: { where: { type: "AMENDMENT" as const }, orderBy: { createdAt: "desc" as const }, take: 1, select: { afterSnapshot: true } },
  attendees: {
    orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
    // The profile snapshot is read only for the person's name and the age the registration saved; never a birth date.
    select: { profileSnapshot: true, formResponses: true, person: { select: { firstName: true, lastName: true } } },
  },
  // A promoted waitlist registration records its card fee here and leaves the pricing snapshot alone (as the cancellation policy reads it).
  paymentChoiceOperations: { orderBy: { sequence: "desc" as const }, take: 1, select: { processingFeeCents: true } },
  payments: { where: { status: "SUCCEEDED" as const }, select: { amount: true, refunds: { where: { status: "SUCCEEDED" as const }, select: { amount: true } } } },
  clubRegistration: { select: { teamName: true, organization: { select: { name: true } } } },
  groupRegistration: { select: { id: true } },
} satisfies Prisma.RegistrationSelect;

export type RegistrationPdfOverrides = {
  /** An amendment's new registration-level answers and pricing, before its operation row exists. */
  registrationResponses?: Record<string, unknown>;
  pricingSnapshot?: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cents(value: Prisma.Decimal | number | string) {
  return Math.round(Number(value) * 100);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatInZone(date: Date, timezone: string) {
  const options = { year: "numeric", month: "long", day: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}

function feesFor(input: {
  snapshot: Record<string, unknown>;
  totalCents: number;
  paidCents: number;
  churchBilled: boolean;
  rosterEnabled: boolean;
  attendeeNames: string[];
  /** The latest payment choice's fee, which wins over the snapshot's. */
  choiceFeeCents?: number;
}): RegistrationPdfFees {
  if (input.churchBilled) {
    return churchBilledFees(perPersonPriceFromSnapshot(input.snapshot, input.rosterEnabled, input.attendeeNames));
  }
  const items = Array.isArray(input.snapshot.lineItems) ? input.snapshot.lineItems : [];
  const lines: Array<{ label: string; amountCents: number }> = [];
  for (const entry of items) {
    const item = record(entry);
    if (typeof item.label !== "string" || typeof item.amountCents !== "number" || !Number.isFinite(item.amountCents)) continue;
    const who = typeof item.attendeeLabel === "string" && item.attendeeLabel.trim() ? ` (${item.attendeeLabel.trim()})` : "";
    lines.push({ label: `${item.label}${who}`, amountCents: item.amountCents });
  }
  const discount = typeof input.snapshot.discountAmountCents === "number" ? input.snapshot.discountAmountCents : 0;
  if (discount > 0) lines.push({ label: "Promo code discount", amountCents: -discount });
  const processing = typeof input.choiceFeeCents === "number"
    ? input.choiceFeeCents
    : typeof input.snapshot.processingFeeCents === "number" ? input.snapshot.processingFeeCents : 0;
  if (processing > 0) lines.push({ label: CARD_PROCESSING_LABEL, amountCents: processing });
  // Whatever else moved the total (a lodging charge, a staff adjustment) is one line, so the table always adds up.
  const listed = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (listed !== input.totalCents && (lines.length > 0 || input.totalCents !== 0)) {
    lines.push({ label: lines.length === 0 ? "Registration total" : "Other charges and adjustments", amountCents: input.totalCents - listed });
  }
  return { kind: "AMOUNTS", lines, totalCents: input.totalCents, paidCents: input.paidCents, owedCents: Math.max(input.totalCents - input.paidCents, 0), processingFeeCents: processing };
}

/** Everything the PDF says, from the registration as it is now. Null when the registration did not come through a form. */
export async function loadRegistrationPdfSource(
  client: Client,
  eventId: string,
  registrationId: string,
  overrides: RegistrationPdfOverrides = {},
): Promise<{ source: RegistrationPdfSource; formVersionId: string; timezone: string; eventName: string; clubName: string | null; registrantName: string } | null> {
  const registration = await client.registration.findFirst({ where: { id: registrationId, eventId }, select: registrationSelect });
  const submission = registration?.publicFormSubmission;
  if (!registration || !submission) return null;
  // An older stored definition that no longer parses gets no PDF, never an error (the registration is unaffected).
  const parsedDefinition = registrationFormDefinitionSchema.safeParse(submission.formVersion.definition);
  if (!parsedDefinition.success) return null;
  const definition = parsedDefinition.data;
  const latestResponses = record(record(registration.operations[0]?.afterSnapshot).registrationResponses);
  const registrationResponses = overrides.registrationResponses
    ?? (Object.keys(latestResponses).length > 0 ? latestResponses : record(submission.responses));
  const snapshot = overrides.pricingSnapshot ?? currentPricingSnapshot(registration);
  const contact = record(registration.contactSnapshot);
  const registrantName = `${text(contact.firstName) || registration.accountHolderPerson.firstName} ${text(contact.lastName) || registration.accountHolderPerson.lastName}`.trim();
  const attendees = registration.attendees.map((attendee) => {
    const profile = record(attendee.profileSnapshot);
    const name = `${text(profile.firstName) || attendee.person.firstName} ${text(profile.lastName) || attendee.person.lastName}`.trim();
    return {
      name,
      ageOnEventDate: typeof profile.ageOnEventDate === "number" && Number.isFinite(profile.ageOnEventDate) ? profile.ageOnEventDate : null,
      responses: record(attendee.formResponses),
    };
  });
  const totalCents = cents(registration.totalAmount);
  const paidCents = registration.payments.reduce((sum, payment) => sum + cents(payment.amount) - payment.refunds.reduce((refunded, refund) => refunded + cents(refund.amount), 0), 0);
  const churchBilled = registration.event.billingMode === "DEFERRED_ORGANIZATION_INVOICE" && !registration.groupRegistration;
  const clubName = registration.clubRegistration?.organization.name ?? null;
  const source: RegistrationPdfSource = {
    eventName: registration.event.name,
    eventDates: formatMessageDateRange(registration.event.startsAt, registration.event.endsAt, { timeZone: registration.event.timezone }),
    eventLocation: registration.location
      ? [registration.location.name, registration.location.address].filter(Boolean).join(", ")
      : registration.event.location ?? "",
    formTitle: definition.title,
    definition,
    registrationResponses,
    attendees,
    clubName,
    teamName: registration.clubRegistration?.teamName ?? null,
    registrantName,
    submittedOn: registration.submittedAt ? formatInZone(registration.submittedAt, registration.event.timezone) : null,
    fees: feesFor({
      snapshot,
      totalCents,
      paidCents,
      churchBilled,
      rosterEnabled: getAttendeeRosterConfig(definition).enabled,
      attendeeNames: attendees.map((attendee) => attendee.name),
      ...(typeof registration.paymentChoiceOperations[0]?.processingFeeCents === "number" ? { choiceFeeCents: registration.paymentChoiceOperations[0].processingFeeCents } : {}),
    }),
  };
  return { source, formVersionId: submission.formVersionId, timezone: registration.event.timezone, eventName: registration.event.name, clubName, registrantName };
}

export type RegistrationPdfDocumentInfo = {
  id: string;
  version: number;
  attachmentId: string;
  sha256: string;
  filename: string;
  sizeBytes: number;
  updated: boolean;
  createdAt: string;
};

const documentSelect = {
  id: true,
  version: true,
  attachmentId: true,
  sha256: true,
  updated: true,
  contentHash: true,
  createdAt: true,
  attachment: { select: { filename: true, sizeBytes: true } },
} satisfies Prisma.RegistrationPdfDocumentSelect;

type StoredDocument = Prisma.RegistrationPdfDocumentGetPayload<{ select: typeof documentSelect }>;

function info(row: StoredDocument): RegistrationPdfDocumentInfo {
  return { id: row.id, version: row.version, attachmentId: row.attachmentId, sha256: row.sha256, filename: row.attachment.filename, sizeBytes: row.attachment.sizeBytes, updated: row.updated, createdAt: row.createdAt.toISOString() };
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export type EnsuredRegistrationPdf = {
  document: RegistrationPdfDocumentInfo;
  /** True when this call made a new version (so a change should be announced); false when the latest already says the same. */
  created: boolean;
  /** The version this one followed, or null when it is the first. */
  previousVersion: number | null;
};

/**
 * The PDF for the registration as it is now: the latest version when it already says the same, else a new version.
 * Returns null when the registration has no form to lay out, or the PDF is over the email size cap (logged; the caller
 * then sends without it, and the download route says so).
 *
 * Never call this inside a gated or Serializable registration transaction (docs/MEALS.md): it is slow work and a failure
 * must not fail a registration. `after-commit.ts` calls it after the commit and catches everything.
 */
export async function ensureRegistrationPdf(
  client: Client,
  input: {
    eventId: string;
    registrationId: string;
    now?: Date;
    overrides?: RegistrationPdfOverrides;
    /**
     * Set only by the step that announces a change (`finishRegistrationChange`). A version is marked UPDATED only then, and
     * only when an earlier version exists or the change itself was meaningful. A version made at download time, or at
     * submit, is never marked.
     */
    notifiedChange?: { meaningful: boolean };
  },
): Promise<EnsuredRegistrationPdf | null> {
  const loaded = await loadRegistrationPdfSource(client, input.eventId, input.registrationId, input.overrides);
  if (!loaded) return null;
  const model = buildRegistrationPdfModel(loaded.source);
  const contentHash = registrationPdfContentHash(model);
  const latest = await client.registrationPdfDocument.findFirst({
    where: { registrationId: input.registrationId, eventId: input.eventId },
    orderBy: { version: "desc" },
    select: documentSelect,
  });
  if (latest && latest.contentHash === contentHash) return { document: info(latest), created: false, previousVersion: latest.version };
  const version = (latest?.version ?? 0) + 1;
  const updated = Boolean(input.notifiedChange) && (latest !== null || input.notifiedChange!.meaningful);
  const generatedAt = input.now ?? new Date();
  const bytes = await renderRegistrationPdf({ model, updated, generatedAt, timezone: loaded.timezone });
  if (bytes.byteLength > REGISTRATION_PDF_MAX_BYTES) {
    logWarn("A registration PDF was over the email size limit and was not made.", { registrationId: input.registrationId, sizeBytes: bytes.byteLength });
    return null;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = registrationPdfFilename({ eventName: loaded.eventName, clubName: loaded.clubName, registrantName: loaded.registrantName, updated });
  const created = await client.registrationPdfDocument.create({
    data: {
      event: { connect: { id: input.eventId } },
      registration: { connect: { id: input.registrationId } },
      version,
      sha256,
      contentHash,
      generatorVersion: REGISTRATION_PDF_GENERATOR_VERSION,
      formVersionId: loaded.formVersionId,
      updated,
      attachment: { create: { eventId: input.eventId, filename, contentType: "application/pdf", sizeBytes: bytes.byteLength, sha256, content: Buffer.from(bytes) } },
    },
    select: documentSelect,
  });
  return { document: info(created), created: true, previousVersion: latest?.version ?? null };
}

/** A club director's download (#1082): see `readClubRegistrationPdfForDownload`. */
export type ClubPdfRequest = { organizationId: string; eventId: string; teamKey?: string | null };

/** For a download outside any transaction: two requests racing to make the same version settle on the first one's. */
export async function ensureRegistrationPdfOutsideTransaction(input: Parameters<typeof ensureRegistrationPdf>[1]) {
  const prisma = getPrisma();
  try {
    return await ensureRegistrationPdf(prisma, input);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return ensureRegistrationPdf(prisma, input);
  }
}

export class RegistrationPdfError extends Error {
  constructor(message: string, readonly code: "NOT_AVAILABLE" | "DOCUMENT_CORRUPT") {
    super(message);
    this.name = "RegistrationPdfError";
  }
}

/** Who downloaded, for the audit entry: ids only, never a name or an address. */
export type RegistrationPdfActor = { userId: string } | { accountId: string } | { userId: string; actAsId: string };

/**
 * The stored bytes of the registration's current PDF, verified against the recorded hash and never altered. A
 * registration changed by a path that sends no notice (a self-service answer, say) gets its new version here, on the
 * first download, so a download is never behind the registration; that version is not marked Updated and no email is sent.
 * Every download is audited (actor, registration, version).
 */
export async function readRegistrationPdfForDownload(eventId: string, registrationId: string, actor: RegistrationPdfActor) {
  const ensured = await ensureRegistrationPdfOutsideTransaction({ eventId, registrationId });
  if (!ensured) throw new RegistrationPdfError("This registration has no PDF. It did not come through a registration form, or the PDF is over the size limit.", "NOT_AVAILABLE");
  const prisma = getPrisma();
  const attachment = await prisma.messageAttachment.findUniqueOrThrow({ where: { id: ensured.document.attachmentId }, select: { content: true, sha256: true, filename: true, contentType: true } });
  const actual = createHash("sha256").update(attachment.content).digest("hex");
  if (actual !== ensured.document.sha256 || actual !== attachment.sha256) {
    throw new RegistrationPdfError("The stored registration PDF does not match its recorded hash, so it was not used. Tell a system administrator.", "DOCUMENT_CORRUPT");
  }
  await writeAuditLog({
    eventId,
    ...("userId" in actor ? { actorUserId: actor.userId } : {}),
    action: "REGISTRATION_PDF_DOWNLOADED",
    entityType: "Registration",
    entityId: registrationId,
    summary: `Downloaded version ${ensured.document.version} of a registration PDF.`,
    metadata: {
      registrationId,
      version: ensured.document.version,
      ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : {}),
      ...("actAsId" in actor ? { actAsId: actor.actAsId } : {}),
    },
  });
  return { bytes: attachment.content, sha256: actual, filename: attachment.filename, contentType: attachment.contentType, version: ensured.document.version };
}

/**
 * A club director's download (#1082): the PDF of this club's own registration for this event (the team's, on an event with
 * teams; the empty key otherwise). The caller has already proved the person directs the club; this checks the registration
 * really is that club's for that event, so another club's or event's can never be named. Only an active registration
 * (submitted or confirmed) has a download, matching the club page that offers it.
 */
export async function readClubRegistrationPdfForDownload(input: ClubPdfRequest & { actor: RegistrationPdfActor }) {
  const clubRegistration = await getPrisma().clubEventRegistration.findUnique({
    where: { eventId_organizationId_teamKey: { eventId: input.eventId, organizationId: input.organizationId, teamKey: input.teamKey ?? NO_TEAM_KEY } },
    select: { registrationId: true, registration: { select: { status: true } } },
  });
  if (!clubRegistration || !(activeRegistrationStatuses as readonly string[]).includes(clubRegistration.registration.status)) {
    throw new RegistrationPdfError("This club has no active registration for this event.", "NOT_AVAILABLE");
  }
  return readRegistrationPdfForDownload(input.eventId, clubRegistration.registrationId, input.actor);
}
