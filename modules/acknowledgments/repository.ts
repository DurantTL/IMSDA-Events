import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  approvedRequestMetadata,
  decideActing,
  evidenceRequestHash,
  hasLiveAcceptance,
  latestLiveAction,
  normalizePaperLocation,
  planAcknowledgments,
  policyContent,
  resolveAcknowledgmentStatus,
  staffEvidenceKey,
  submissionEvidenceKey,
  textContent,
  acknowledgmentFields,
  withdrawalRequestHash,
  type AcknowledgmentAction,
  type AcknowledgmentChannel,
  type AcknowledgmentDisplay,
  type HistoryRow,
  type AcknowledgmentStatusCode,
  type ActingDecision,
  type ShownContent,
} from "@/modules/acknowledgments/domain";
import { ConsentPolicyError, getPolicyVersionEffectiveAt, getPolicyVersionForEvidence } from "@/modules/consent/repository";
import { PolicyKindMismatchError } from "@/modules/consent/domain";
import {
  isFieldVisible,
  registrationFormDefinitionSchema,
  type RegistrationFormDefinition,
  type RegistrationFormField,
} from "@/modules/forms/definition";
import { eventStartDate, minorStatusAt, personAgeFromAnswers, type MinorStatus } from "@/modules/guardian-authority/domain";
import { findActiveDeclaredAuthority } from "@/modules/guardian-authority/repository";
import { formatPersonName } from "@/lib/person-name";

/**
 * Acknowledgment evidence (#150). One append-only row per acknowledgment: who it is about, who gave it, exactly what
 * was shown (the text, or a published #129 policy version by id), when, through which channel, and approved request
 * metadata. Nothing here reads household, surname, email, `canManage` or the account holder to decide who may act for
 * a minor: only a declared #131 responsible adult can.
 *
 * Evidence is written inside the caller's transaction, so it commits or rolls back with the registration it belongs to.
 * A retry cannot create a second row: an idempotency key replays the first result, and a unique index per subject kind
 * stops the same content being recorded twice for the same subject and field. Audit entries carry ids only, never text.
 *
 * Decline and withdrawal (#130) are further events on the same history, never edits: a decline is another evidence row
 * (action DECLINE), a withdrawal is a separate append-only row naming the acceptance it withdraws. Every action write
 * takes a transaction-scoped advisory lock on its subject and field first, so two submissions that race end in exactly
 * one event. Status is derived from the history at read time (`latestLiveAction`), never stored.
 */

export type AcknowledgmentErrorCode =
  | "REGISTRATION_NOT_FOUND"
  | "REGISTRATION_NOT_ACTIVE"
  | "FORM_VERSION_UNAVAILABLE"
  | "FIELD_NOT_FOUND"
  | "FIELD_NOT_APPLICABLE"
  | "ATTENDEE_REQUIRED"
  | "ATTENDEE_NOT_ALLOWED"
  | "ATTENDEE_NOT_FOUND"
  | "ACTOR_NOT_FOUND"
  | "ACKNOWLEDGED_AT_INVALID"
  | "POLICY_VERSION_UNAVAILABLE"
  | "ACTING_FOR_MINOR_NOT_AUTHORIZED"
  | "ACTING_FOR_ANOTHER_NOT_AUTHORIZED"
  | "ACKNOWLEDGMENT_REFUSED"
  | "IDEMPOTENCY_CONFLICT"
  | "REASON_REQUIRED"
  | "EVIDENCE_NOT_FOUND"
  | "ALREADY_ACKNOWLEDGED"
  | "EVIDENCE_NOT_WITHDRAWABLE"
  | "EVIDENCE_VOIDED"
  | "WITHDRAWN_AT_INVALID"
  | "PAPER_LOCATION_REQUIRED"
  | "PAPER_LOCATION_NOT_ALLOWED";

export type AcknowledgmentRefusal = {
  fieldId: string;
  key: string;
  /** The attendee's client id on the form; null for a registration-level acknowledgment. */
  attendeeClientId: string | null;
  code: "ACTING_FOR_MINOR_NOT_AUTHORIZED" | "ACTING_FOR_ANOTHER_NOT_AUTHORIZED" | "POLICY_VERSION_UNAVAILABLE";
  message: string;
};

export class AcknowledgmentError extends Error {
  constructor(
    public readonly code: AcknowledgmentErrorCode,
    message: string,
    public readonly refusals: AcknowledgmentRefusal[] = [],
  ) {
    super(message);
    this.name = "AcknowledgmentError";
  }
}

type Client = Prisma.TransactionClient | PrismaClient;

const IN_SCOPE_STATUSES = ["SUBMITTED", "CONFIRMED", "WAITLISTED"] as const;
/** Browser and clock allowance for an "acknowledged at" that is a little ahead of the server. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// ---------------------------------------------------------------------------------------------
// What the evidence names (no payload)
// ---------------------------------------------------------------------------------------------

/** One evidence row without its payload: no shown text, no request metadata, no idempotency data. */
export type EvidenceSummary = {
  id: string;
  registrationId: string;
  registrationAttendeeId: string | null;
  subjectPersonId: string | null;
  actedByPersonId: string;
  channel: AcknowledgmentChannel;
  /** ACKNOWLEDGE or DECLINE (#130). */
  action: AcknowledgmentAction;
  fieldKey: string;
  fieldLabel: string;
  source: "TEXT" | "POLICY_VERSION";
  policyVersionId: string | null;
  contentHash: string;
  subjectMinorStatus: string;
  guardianAuthorityId: string | null;
  acknowledgedAt: string;
  recordedAt: string;
  /** When staff voided it (a correction, #150); null while it stands. The reason is only in the payload read. */
  voidedAt: string | null;
  /** The withdrawal of this acceptance (#130), if any: when, and how. No wording, no metadata, no paper location. */
  withdrawal: { id: string; withdrawnAt: string; recordedAt: string; channel: AcknowledgmentChannel } | null;
};

const summarySelect = {
  id: true,
  registrationId: true,
  registrationAttendeeId: true,
  subjectPersonId: true,
  actedByPersonId: true,
  channel: true,
  action: true,
  fieldKey: true,
  fieldLabel: true,
  source: true,
  policyVersionId: true,
  contentHash: true,
  subjectMinorStatus: true,
  guardianAuthorityId: true,
  acknowledgedAt: true,
  recordedAt: true,
  void: { select: { voidedAt: true } },
  withdrawal: { select: { id: true, withdrawnAt: true, recordedAt: true, channel: true } },
} as const;

type SummaryRow = Prisma.AcknowledgmentEvidenceGetPayload<{ select: typeof summarySelect }>;

function summarize(row: SummaryRow): EvidenceSummary {
  return {
    id: row.id,
    registrationId: row.registrationId,
    registrationAttendeeId: row.registrationAttendeeId,
    subjectPersonId: row.subjectPersonId,
    actedByPersonId: row.actedByPersonId,
    channel: row.channel,
    action: row.action,
    fieldKey: row.fieldKey,
    fieldLabel: row.fieldLabel,
    source: row.source,
    policyVersionId: row.policyVersionId,
    contentHash: row.contentHash,
    subjectMinorStatus: row.subjectMinorStatus,
    guardianAuthorityId: row.guardianAuthorityId,
    voidedAt: row.void?.voidedAt ? row.void.voidedAt.toISOString() : null,
    withdrawal: row.withdrawal
      ? { id: row.withdrawal.id, withdrawnAt: row.withdrawal.withdrawnAt.toISOString(), recordedAt: row.withdrawal.recordedAt.toISOString(), channel: row.withdrawal.channel }
      : null,
    acknowledgedAt: row.acknowledgedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Resolving what was shown
// ---------------------------------------------------------------------------------------------

/**
 * The content a field shows, exactly. Text is the wording on the (immutable, published) form version; a policy
 * version is looked up by its id for this event and must be published and of the acknowledgment kind. A version of
 * another event's policy, a draft, or a policy of another kind is not found.
 */
export async function resolveShownContent(eventId: string, field: RegistrationFormField): Promise<ShownContent> {
  const config = field.acknowledgment;
  if (field.type !== "ACKNOWLEDGMENT" || !config) {
    throw new AcknowledgmentError("FIELD_NOT_FOUND", "That field is not an acknowledgment.");
  }
  if (config.source === "TEXT") return textContent(config.text);
  try {
    const version = await getPolicyVersionForEvidence(eventId, config.policyVersionId, "ACKNOWLEDGMENT");
    return policyContent(version);
  } catch (error) {
    if (error instanceof ConsentPolicyError || error instanceof PolicyKindMismatchError) {
      throw new AcknowledgmentError("POLICY_VERSION_UNAVAILABLE", "The policy version this acknowledgment points to is not available to this event.");
    }
    throw error;
  }
}

/**
 * Builder-time check (#150): every policy-version acknowledgment in a definition must point at a published
 * acknowledgment-kind version the event can reach. Throws `POLICY_VERSION_UNAVAILABLE` naming the field.
 */
export async function assertAcknowledgmentPoliciesAvailable(eventId: string, definition: RegistrationFormDefinition) {
  for (const field of acknowledgmentFields(definition)) {
    if (field.acknowledgment?.source !== "POLICY_VERSION") continue;
    try {
      await resolveShownContent(eventId, field);
    } catch (error) {
      if (error instanceof AcknowledgmentError) {
        throw new AcknowledgmentError(error.code, `"${field.label}" points to a policy version this event cannot use. Choose a published acknowledgment policy version.`);
      }
      throw error;
    }
  }
}

/**
 * The wording a public form shows for each policy-version acknowledgment, by field id. Only wording: never evidence.
 * A field whose version cannot be read is left out, and the form then shows it as unavailable.
 */
export async function loadAcknowledgmentDisplayContent(
  eventId: string,
  definition: RegistrationFormDefinition,
): Promise<Record<string, AcknowledgmentDisplay>> {
  const content: Record<string, AcknowledgmentDisplay> = {};
  for (const field of acknowledgmentFields(definition)) {
    if (field.acknowledgment?.source !== "POLICY_VERSION") continue;
    try {
      const version = await getPolicyVersionForEvidence(eventId, field.acknowledgment.policyVersionId, "ACKNOWLEDGMENT");
      content[field.id] = { source: "POLICY_VERSION", title: version.title, text: version.bodyText, versionNumber: version.versionNumber };
    } catch (error) {
      if (!(error instanceof ConsentPolicyError || error instanceof PolicyKindMismatchError)) throw error;
    }
  }
  return content;
}

// ---------------------------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------------------------

export type RecordRequest = {
  eventId: string;
  registrationId: string;
  formVersionId: string;
  field: RegistrationFormField;
  /** The attendee the acknowledgment is about, with their minor status on the event's start date; null for the registration. */
  attendee: { attendeeId: string; personId: string; status: MinorStatus["status"] } | null;
  /** The person who acknowledged: the registrant, or whoever signed the paper. */
  actedByPersonId: string;
  channel: AcknowledgmentChannel;
  /** The staff user for a staff-entered or paper acknowledgment; null online. */
  recordedByUserId: string | null;
  acknowledgedAt: Date;
  idempotencyKey: string;
  requestMetadata?: Record<string, unknown>;
  /** ACKNOWLEDGE (the default) or DECLINE (#130; staff-recorded only, never ONLINE). */
  action?: AcknowledgmentAction;
  /** Where a PAPER form lives; required for PAPER and refused for every other channel. Never its contents. */
  paperLocation?: string | null;
};

export type RecordOutcome = {
  evidence: EvidenceSummary;
  /** A new row was written. */
  created: boolean;
  /** The same request (same idempotency key) had already been recorded; its result is returned unchanged. */
  replayed: boolean;
};

/** The latest acceptance (highest generation) for this subject, field and content: the one that is live unless it was voided or withdrawn. */
async function findByNaturalKey(client: Client, request: RecordRequest, contentRef: string) {
  return client.acknowledgmentEvidence.findFirst({
    where: {
      registrationId: request.registrationId,
      registrationAttendeeId: request.attendee?.attendeeId ?? null,
      fieldKey: request.field.key,
      contentRef,
      action: "ACKNOWLEDGE",
    },
    orderBy: { generation: "desc" },
    select: { ...summarySelect, generation: true },
  });
}

/**
 * Serializes every action write (acknowledge, decline, withdraw) for one subject and field: a transaction-scoped advisory
 * lock, released at commit or rollback. Two submissions that race, under different request keys, take turns, so the second
 * sees the first's row and ends in exactly one action event instead of two. The key never leaves the database.
 */
async function lockSubjectField(tx: Client, registrationId: string, attendeeId: string | null, fieldKey: string) {
  const key = `acknowledgment:${registrationId}:${attendeeId ?? "registration"}:${fieldKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Everything recorded for one subject and field, oldest first, shaped for the status rules. */
async function readSubjectHistory(client: Client, request: Pick<RecordRequest, "registrationId" | "attendee" | "field">) {
  const rows = await client.acknowledgmentEvidence.findMany({
    where: { registrationId: request.registrationId, registrationAttendeeId: request.attendee?.attendeeId ?? null, fieldKey: request.field.key },
    orderBy: [{ acknowledgedAt: "asc" }, { id: "asc" }],
    select: { ...summarySelect, contentRef: true },
  });
  return rows.map((row) => {
    const summary = summarize(row);
    return { ...historyRow(summary), contentRef: row.contentRef, summary };
  });
}

/** A summary as the status rules read it. */
function historyRow(summary: EvidenceSummary): HistoryRow & { source: "TEXT" | "POLICY_VERSION"; policyVersionId: string | null } {
  return {
    action: summary.action,
    acknowledgedAt: summary.acknowledgedAt,
    recordedAt: summary.recordedAt,
    voidedAt: summary.voidedAt,
    withdrawal: summary.withdrawal,
    source: summary.source,
    policyVersionId: summary.policyVersionId,
  };
}

/**
 * Writes one acknowledgment or decline inside the caller's transaction.
 *
 * Order matters. The subject and field are locked first (see `lockSubjectField`). A request that was already recorded
 * under the same idempotency key then replays its first result before anything else is judged, so a retry still succeeds
 * after the authority behind it has since changed. A different request under the same key is refused. Otherwise who may
 * act is decided (a minor needs the declared responsible adult), and then the row is written once.
 *
 * - Acknowledge: the same subject, field and content a second time returns the live row already on file instead of adding a
 *   duplicate; a voided or withdrawn one is followed by the next generation.
 * - Decline: refused while a live acceptance exists (withdraw it instead); a repeat of the latest live decline of the
 *   same content returns that row. A decline is never recorded online.
 */
export async function recordAcknowledgmentEvidence(tx: Prisma.TransactionClient, request: RecordRequest): Promise<RecordOutcome> {
  const action: AcknowledgmentAction = request.action ?? "ACKNOWLEDGE";
  const location = normalizePaperLocation(request.channel, request.paperLocation);
  if (!location.ok) throw new AcknowledgmentError(location.code, location.message);
  if (action === "DECLINE" && request.channel === "ONLINE") {
    throw new AcknowledgmentError("ACKNOWLEDGMENT_REFUSED", "A decline is recorded by staff, never from the online form.");
  }
  const content = await resolveShownContent(request.eventId, request.field);
  const identity = {
    eventId: request.eventId,
    registrationId: request.registrationId,
    registrationAttendeeId: request.attendee?.attendeeId ?? null,
    fieldKey: request.field.key,
    actedByPersonId: request.actedByPersonId,
    channel: request.channel,
    contentRef: content.contentRef,
    action,
    paperLocation: location.value,
  };
  const requestHash = evidenceRequestHash(identity);

  await lockSubjectField(tx, request.registrationId, request.attendee?.attendeeId ?? null, request.field.key);

  const keyed = await tx.acknowledgmentEvidence.findUnique({
    where: { eventId_idempotencyKey: { eventId: request.eventId, idempotencyKey: request.idempotencyKey } },
    select: { ...summarySelect, requestHash: true },
  });
  if (keyed) {
    if (keyed.requestHash !== requestHash) {
      throw new AcknowledgmentError("IDEMPOTENCY_CONFLICT", "That request id was already used for a different acknowledgment.");
    }
    const { requestHash: _unused, ...row } = keyed;
    void _unused;
    return { evidence: summarize(row), created: false, replayed: true };
  }

  const authority = request.attendee && request.attendee.status === "MINOR"
    ? await findActiveDeclaredAuthority(tx, request.eventId, request.attendee.personId, request.registrationId)
    : null;
  const decision: ActingDecision = decideActing({
    subject: { personId: request.attendee?.personId ?? null, status: request.attendee?.status ?? "ADULT" },
    actedByPersonId: request.actedByPersonId,
    authority,
  });
  if (!decision.allowed) throw new AcknowledgmentError(decision.code, decision.message);

  let generation = 0;
  if (action === "DECLINE") {
    const history = await readSubjectHistory(tx, request);
    if (hasLiveAcceptance(history)) {
      throw new AcknowledgmentError("ALREADY_ACKNOWLEDGED", "This person has a standing acknowledgment. Withdraw it instead of recording a decline.");
    }
    const latest = latestLiveAction(history);
    if (latest?.kind === "DECLINE" && latest.row.contentRef === content.contentRef) {
      return { evidence: latest.row.summary, created: false, replayed: false };
    }
  } else {
    const existing = await findByNaturalKey(tx, request, content.contentRef);
    if (existing && !existing.void && !existing.withdrawal) return { evidence: summarize(existing), created: false, replayed: false };
    // A voided or withdrawn acceptance can be recorded again: the next generation (all earlier ones are voided or withdrawn, so this is their count).
    generation = existing ? existing.generation + 1 : 0;
  }

  const id = randomUUID();
  const inserted = await tx.acknowledgmentEvidence.createMany({
    skipDuplicates: true,
    data: [{
      id,
      eventId: request.eventId,
      registrationId: request.registrationId,
      registrationAttendeeId: request.attendee?.attendeeId ?? null,
      subjectPersonId: request.attendee?.personId ?? null,
      actedByPersonId: request.actedByPersonId,
      recordedByUserId: request.recordedByUserId,
      channel: request.channel,
      action,
      paperLocation: location.value,
      formVersionId: request.formVersionId,
      fieldId: request.field.id,
      fieldKey: request.field.key,
      fieldLabel: request.field.label,
      source: content.source,
      shownText: content.shownText,
      policyVersionId: content.policyVersionId,
      contentHash: content.contentHash,
      contentRef: content.contentRef,
      subjectMinorStatus: request.attendee?.status ?? "ADULT",
      guardianAuthorityId: decision.guardianAuthorityId,
      acknowledgedAt: request.acknowledgedAt,
      requestMetadata: approvedRequestMetadata(request.requestMetadata) as Prisma.InputJsonValue,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      generation,
    }],
  });
  if (inserted.count === 0) {
    // Lost a race to an identical request: whatever won is the evidence.
    const winner = await tx.acknowledgmentEvidence.findUnique({
      where: { eventId_idempotencyKey: { eventId: request.eventId, idempotencyKey: request.idempotencyKey } },
      select: summarySelect,
    }) ?? (action === "ACKNOWLEDGE" ? await findByNaturalKey(tx, request, content.contentRef) : null);
    if (!winner) throw new AcknowledgmentError("IDEMPOTENCY_CONFLICT", "That acknowledgment could not be recorded. Try again.");
    return { evidence: summarize(winner), created: false, replayed: false };
  }
  const row = await tx.acknowledgmentEvidence.findUniqueOrThrow({ where: { id }, select: summarySelect });
  await writeAuditLog({
    eventId: request.eventId,
    actorUserId: request.recordedByUserId ?? undefined,
    action: action === "DECLINE" ? "ACKNOWLEDGMENT_DECLINED" : "ACKNOWLEDGMENT_RECORDED",
    entityType: "AcknowledgmentEvidence",
    entityId: id,
    // Ids and flags only: never the shown text, the label, the paper location, or the request metadata.
    summary: `${action === "DECLINE" ? "Recorded a declined acknowledgment" : "Recorded an acknowledgment"} (${request.channel.toLowerCase().replace("_", " ")}).`,
    metadata: {
      eventId: request.eventId,
      registrationId: request.registrationId,
      registrationAttendeeId: request.attendee?.attendeeId ?? null,
      fieldKey: request.field.key,
      channel: request.channel,
      action,
      source: content.source,
      policyVersionId: content.policyVersionId,
      subjectMinorStatus: request.attendee?.status ?? "ADULT",
      guardianAuthorityId: decision.guardianAuthorityId,
    },
  }, tx);
  return { evidence: summarize(row), created: true, replayed: false };
}

// ---------------------------------------------------------------------------------------------
// A registration form submission (online, or staff acting for a club)
// ---------------------------------------------------------------------------------------------

export type SubmissionAcknowledgmentInput = {
  eventId: string;
  registrationId: string;
  formVersionId: string;
  definition: RegistrationFormDefinition;
  registrationResponses: Record<string, unknown>;
  attendees: ReadonlyArray<{ clientId: string; attendeeId: string; personId: string; responses: Record<string, unknown> }>;
  /** The submitter: the account holder person. */
  actedByPersonId: string;
  /** ONLINE for the registrant's own submission; STAFF_ENTERED when staff submitted it for them. */
  channel: Exclude<AcknowledgmentChannel, "PAPER">;
  recordedByUserId: string | null;
  /** The submission's idempotency key: a retried submission derives the same evidence keys. */
  submissionKey: string;
  acknowledgedAt: Date;
  requestMetadata?: Record<string, unknown>;
  event: { startsAt: Date; timezone: string; ageOfMajority: number };
};

/**
 * Records the acknowledgments a committed-in-this-transaction registration gives, one per visible, ticked
 * acknowledgment field (per attendee for attendee-level fields). Every refusal is collected and thrown together, so
 * the form can mark each field; any refusal rolls the whole registration back.
 */
export async function recordSubmissionAcknowledgments(tx: Prisma.TransactionClient, input: SubmissionAcknowledgmentInput) {
  const planned = planAcknowledgments(input.definition, {
    registrationResponses: input.registrationResponses,
    attendees: input.attendees,
  });
  const startDate = eventStartDate(input.event.startsAt, input.event.timezone);
  const refusals: AcknowledgmentRefusal[] = [];
  let recorded = 0;
  for (const item of planned) {
    const attendee = item.attendeeClientId === null
      ? null
      : input.attendees.find((candidate) => candidate.clientId === item.attendeeClientId) ?? null;
    if (item.attendeeClientId !== null && !attendee) continue;
    try {
      const outcome = await recordAcknowledgmentEvidence(tx, {
        eventId: input.eventId,
        registrationId: input.registrationId,
        formVersionId: input.formVersionId,
        field: item.field,
        attendee: attendee
          ? {
              attendeeId: attendee.attendeeId,
              personId: attendee.personId,
              // The attendee's own answers only, as the guardian declaration classifies them.
              status: minorStatusAt(personAgeFromAnswers(attendee.responses), startDate, input.event.ageOfMajority).status,
            }
          : null,
        actedByPersonId: input.actedByPersonId,
        channel: input.channel,
        recordedByUserId: input.recordedByUserId,
        acknowledgedAt: input.acknowledgedAt,
        idempotencyKey: submissionEvidenceKey(input.submissionKey, item.field.id, item.attendeeClientId),
        requestMetadata: input.requestMetadata,
      });
      if (outcome.created) recorded += 1;
    } catch (error) {
      if (error instanceof AcknowledgmentError && (
        error.code === "ACTING_FOR_MINOR_NOT_AUTHORIZED"
        || error.code === "ACTING_FOR_ANOTHER_NOT_AUTHORIZED"
        || error.code === "POLICY_VERSION_UNAVAILABLE"
      )) {
        refusals.push({ fieldId: item.field.id, key: item.field.key, attendeeClientId: item.attendeeClientId, code: error.code, message: error.message });
        continue;
      }
      throw error;
    }
  }
  if (refusals.length > 0) {
    throw new AcknowledgmentError("ACKNOWLEDGMENT_REFUSED", refusals[0]!.message, refusals);
  }
  return { planned: planned.length, recorded };
}

// ---------------------------------------------------------------------------------------------
// Staff-entered and paper acknowledgments
// ---------------------------------------------------------------------------------------------

export type StaffAcknowledgmentInput = {
  eventId: string;
  registrationId: string;
  fieldKey: string;
  /** Required for an attendee-level field; refused for a registration-level one. */
  attendeeId?: string | null;
  /** Who acknowledged. Defaults to the registrant for a registration-level field and to the attendee themselves otherwise. */
  actedByPersonId?: string | null;
  channel: "STAFF_ENTERED" | "PAPER";
  /** ACKNOWLEDGE (the default) or DECLINE (#130). */
  action?: AcknowledgmentAction;
  /** Where a PAPER form physically lives (required for PAPER, refused otherwise); never what it says. */
  paperLocation?: string | null;
  /** When it was given (a paper form's date); defaults to now and may not be in the future. */
  acknowledgedAt?: Date | null;
  actorUserId: string;
  /** Kept on retry: the same id returns the first result. */
  clientRequestId: string;
  requestMetadata?: Record<string, unknown>;
};

/**
 * Staff record that a person acknowledged (or declined), on screen or on paper, for an existing registration. The content recorded
 * is what the registration's own form version shows for that field: staff cannot type different wording in. The person
 * who acknowledged must be the subject or, for a minor, the declared responsible adult; staff cannot stand in.
 */
export async function recordStaffAcknowledgment(input: StaffAcknowledgmentInput, now = new Date()): Promise<RecordOutcome> {
  const location = normalizePaperLocation(input.channel, input.paperLocation);
  if (!location.ok) throw new AcknowledgmentError(location.code, location.message);
  const acknowledgedAt = input.acknowledgedAt ?? now;
  if (acknowledgedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new AcknowledgmentError("ACKNOWLEDGED_AT_INVALID", "The acknowledgment date cannot be in the future.");
  }
  return getPrisma().$transaction(async (tx) => {
    const registration = await tx.registration.findFirst({
      where: { id: input.registrationId, eventId: input.eventId },
      select: {
        id: true,
        status: true,
        accountHolderPersonId: true,
        event: { select: { startsAt: true, timezone: true, ageOfMajority: true } },
        publicFormSubmission: { select: { formVersionId: true, responses: true, formVersion: { select: { definition: true } } } },
        attendees: { select: { id: true, personId: true, formResponses: true, profileSnapshot: true } },
      },
    });
    if (!registration) throw new AcknowledgmentError("REGISTRATION_NOT_FOUND", "That registration was not found for this event.");
    if (!(IN_SCOPE_STATUSES as readonly string[]).includes(registration.status)) {
      throw new AcknowledgmentError("REGISTRATION_NOT_ACTIVE", "Acknowledgments can only be recorded on an active registration.");
    }
    const submission = registration.publicFormSubmission;
    if (!submission) throw new AcknowledgmentError("FORM_VERSION_UNAVAILABLE", "This registration was not made through a form, so it has no acknowledgments.");
    const definition = registrationFormDefinitionSchema.parse(submission.formVersion.definition);
    const field = acknowledgmentFields(definition).find((candidate) => candidate.key === input.fieldKey);
    if (!field) throw new AcknowledgmentError("FIELD_NOT_FOUND", "That form has no acknowledgment with that key.");

    let attendee: RecordRequest["attendee"] = null;
    let shared: Record<string, unknown> = record(submission.responses);
    if (field.scope === "ATTENDEE") {
      if (!input.attendeeId) throw new AcknowledgmentError("ATTENDEE_REQUIRED", "Choose the attendee this acknowledgment is for.");
      const row = registration.attendees.find((candidate) => candidate.id === input.attendeeId);
      if (!row) throw new AcknowledgmentError("ATTENDEE_NOT_FOUND", "That attendee is not on this registration.");
      const startDate = eventStartDate(registration.event.startsAt, registration.event.timezone);
      attendee = {
        attendeeId: row.id,
        personId: row.personId,
        status: minorStatusAt(personAgeFromAnswers(record(row.formResponses), record(row.profileSnapshot)), startDate, registration.event.ageOfMajority).status,
      };
      shared = { ...shared, ...record(row.formResponses) };
    } else if (input.attendeeId) {
      throw new AcknowledgmentError("ATTENDEE_NOT_ALLOWED", "That acknowledgment is for the whole registration, not one attendee.");
    }
    // A conditional acknowledgment that does not apply to this person is not recorded for them.
    if (!isFieldVisible(field, shared)) {
      throw new AcknowledgmentError("FIELD_NOT_APPLICABLE", "That acknowledgment does not apply to this person.");
    }
    const actedByPersonId = input.actedByPersonId ?? (attendee ? attendee.personId : registration.accountHolderPersonId);
    // Only the registrant or someone on this registration can have acknowledged on it. Anyone else, whether they exist or not,
    // gets the same answer, so this route cannot be used to find out which people exist.
    const onRegistration = actedByPersonId === registration.accountHolderPersonId
      || registration.attendees.some((candidate) => candidate.personId === actedByPersonId);
    if (!onRegistration) {
      throw new AcknowledgmentError("ACTOR_NOT_FOUND", "The person who acknowledged is not on this registration.");
    }
    return recordAcknowledgmentEvidence(tx, {
      eventId: input.eventId,
      registrationId: registration.id,
      formVersionId: submission.formVersionId,
      field,
      attendee,
      actedByPersonId,
      channel: input.channel,
      action: input.action ?? "ACKNOWLEDGE",
      paperLocation: location.value,
      recordedByUserId: input.actorUserId,
      acknowledgedAt,
      idempotencyKey: staffEvidenceKey(input.clientRequestId),
      requestMetadata: { ...input.requestMetadata, formVersionId: submission.formVersionId },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Reading: status as of a moment, and the payload
// ---------------------------------------------------------------------------------------------

export type SubjectAcknowledgmentView = {
  fieldKey: string;
  fieldLabel: string;
  scope: "REGISTRATION" | "ATTENDEE";
  required: boolean;
  source: "TEXT" | "POLICY_VERSION";
  subject: { kind: "REGISTRATION" } | { kind: "ATTENDEE"; attendeeId: string; personId: string; name: string };
  status: AcknowledgmentStatusCode;
  /** Every evidence row for this subject and field, oldest first. No payload. */
  evidence: EvidenceSummary[];
};

async function statusAt(
  client: Client,
  eventId: string,
  rows: ReadonlyArray<EvidenceSummary>,
  at: Date,
): Promise<AcknowledgmentStatusCode> {
  // The latest live act at the moment: given by then and not voided by then. A void or a withdrawal changes the answer
  // only from its own moment on, so a past moment keeps the answer it had.
  const latest = latestLiveAction(rows.map(historyRow), at);
  if (!latest) return resolveAcknowledgmentStatus({ evidence: null });
  if (latest.kind === "DECLINE") return resolveAcknowledgmentStatus({ evidence: { source: latest.row.source, action: "DECLINE" } });
  if (latest.kind === "WITHDRAWAL") return resolveAcknowledgmentStatus({ evidence: { source: latest.row.source, action: "WITHDRAWAL" } });
  const accepted = latest.row;
  if (accepted.source === "TEXT" || !accepted.policyVersionId) return resolveAcknowledgmentStatus({ evidence: accepted });
  const seen = await client.consentPolicyVersion.findUnique({
    where: { id: accepted.policyVersionId },
    select: { versionNumber: true, policyId: true },
  });
  if (!seen) return resolveAcknowledgmentStatus({ evidence: accepted });
  let effective: { versionNumber: number } | null = null;
  try {
    effective = await getPolicyVersionEffectiveAt(eventId, seen.policyId, at, "ACKNOWLEDGMENT");
  } catch (error) {
    if (!(error instanceof ConsentPolicyError || error instanceof PolicyKindMismatchError)) throw error;
  }
  const laterMaterial = effective && effective.versionNumber > seen.versionNumber
    ? (await client.consentPolicyVersion.count({
        where: {
          policyId: seen.policyId,
          status: "PUBLISHED",
          versionNumber: { gt: seen.versionNumber, lte: effective.versionNumber },
          effectiveFrom: { lte: at },
          isMaterialChange: true,
        },
      })) > 0
    : false;
  return resolveAcknowledgmentStatus({
    evidence: accepted,
    policy: { evidenceVersionNumber: seen.versionNumber, effective, laterVersionIsMaterial: laterMaterial },
  });
}

/**
 * Where each subject of a registration stands on each acknowledgment of its form, as of `at` (default now). Historical:
 * the evidence considered is what existed by then, and a policy-version acknowledgment is judged against the version
 * in force at that moment, so "was this person current in March?" has one answer however the policy changed after.
 * Summaries only: the shown text and request metadata are never returned here.
 */
export async function listRegistrationAcknowledgments(
  eventId: string,
  registrationId: string,
  at: Date = new Date(),
): Promise<SubjectAcknowledgmentView[] | null> {
  const prisma = getPrisma();
  const registration = await prisma.registration.findFirst({
    where: { id: registrationId, eventId },
    select: {
      id: true,
      publicFormSubmission: { select: { responses: true, formVersion: { select: { definition: true } } } },
      attendees: { orderBy: { position: "asc" }, select: { id: true, personId: true, formResponses: true, profileSnapshot: true } },
    },
  });
  if (!registration) return null;
  if (!registration.publicFormSubmission) return [];
  const definition = registrationFormDefinitionSchema.parse(registration.publicFormSubmission.formVersion.definition);
  const fields = acknowledgmentFields(definition);
  if (fields.length === 0) return [];
  const rows = await prisma.acknowledgmentEvidence.findMany({
    where: { registrationId },
    orderBy: [{ acknowledgedAt: "asc" }, { id: "asc" }],
    select: summarySelect,
  });
  const shared = record(registration.publicFormSubmission.responses);
  const views: SubjectAcknowledgmentView[] = [];
  for (const field of fields) {
    const source = field.acknowledgment?.source ?? "TEXT";
    const subjects = field.scope === "REGISTRATION"
      ? [{ subject: { kind: "REGISTRATION" as const }, attendeeId: null as string | null, answers: shared }]
      : registration.attendees.map((attendee) => {
          const profile = record(attendee.profileSnapshot);
          const name = formatPersonName({ firstName: typeof profile.firstName === "string" ? profile.firstName : "", lastName: typeof profile.lastName === "string" ? profile.lastName : "" }) || "Attendee";
          return {
            subject: { kind: "ATTENDEE" as const, attendeeId: attendee.id, personId: attendee.personId, name },
            attendeeId: attendee.id as string | null,
            answers: { ...shared, ...record(attendee.formResponses) },
          };
        });
    for (const candidate of subjects) {
      const evidence = rows
        .filter((row) => row.fieldKey === field.key && row.registrationAttendeeId === candidate.attendeeId)
        .map(summarize);
      // A condition that hides the field for this person leaves nothing to acknowledge, unless they already did.
      if (!isFieldVisible(field, candidate.answers) && evidence.length === 0) continue;
      views.push({
        fieldKey: field.key,
        fieldLabel: field.label,
        scope: field.scope,
        required: field.required,
        source,
        subject: candidate.subject,
        status: await statusAt(prisma, eventId, evidence, at),
        evidence,
      });
    }
  }
  return views;
}

/** The full evidence behind one row, including what the person was shown. Only for a caller allowed to see it. */
export async function getAcknowledgmentEvidencePayload(eventId: string, registrationId: string, evidenceId: string) {
  const row = await getPrisma().acknowledgmentEvidence.findFirst({
    where: { id: evidenceId, eventId, registrationId },
    select: { ...summarySelect, shownText: true, requestMetadata: true, formVersionId: true, paperLocation: true },
  });
  if (!row) throw new AcknowledgmentError("EVIDENCE_NOT_FOUND", "That acknowledgment evidence was not found.");
  const withdrawalRow = row.withdrawal
    ? await getPrisma().acknowledgmentWithdrawal.findUnique({
        where: { evidenceId: row.id },
        select: { id: true, withdrawnAt: true, recordedAt: true, channel: true, actedByPersonId: true, recordedByUserId: true, paperLocation: true },
      })
    : null;
  const voidRow = await getPrisma().acknowledgmentVoid.findUnique({ where: { evidenceId: row.id }, select: { voidedAt: true, voidedByUserId: true, reason: true } });
  let policy: { id: string; versionNumber: number; title: string; bodyText: string; contentHash: string | null } | null = null;
  if (row.policyVersionId) {
    // By exact version id: what this person saw, never what applies now.
    const version = await getPolicyVersionForEvidence(eventId, row.policyVersionId);
    policy = { id: version.id, versionNumber: version.versionNumber, title: version.title, bodyText: version.bodyText, contentHash: version.contentHash };
  }
  return {
    evidence: summarize(row),
    // The void's reason is sensitive and lives only here, behind the sensitive-data permission.
    voided: voidRow ? { voidedAt: voidRow.voidedAt.toISOString(), voidedByUserId: voidRow.voidedByUserId, reason: voidRow.reason } : null,
    // Where the paper form lives (never what it says): sensitive, so only in this payload, never in a summary.
    paperLocation: row.paperLocation,
    withdrawal: withdrawalRow
      ? {
          id: withdrawalRow.id,
          withdrawnAt: withdrawalRow.withdrawnAt.toISOString(),
          recordedAt: withdrawalRow.recordedAt.toISOString(),
          channel: withdrawalRow.channel,
          actedByPersonId: withdrawalRow.actedByPersonId,
          recordedByUserId: withdrawalRow.recordedByUserId,
          paperLocation: withdrawalRow.paperLocation,
        }
      : null,
    formVersionId: row.formVersionId,
    shownText: row.shownText,
    policyVersion: policy,
    requestMetadata: record(row.requestMetadata),
  };
}

export type VoidOutcome = { void: { id: string; evidenceId: string; voidedAt: string }; created: boolean };

/**
 * A correction (#150): staff void an acknowledgment with a reason. The evidence row is never changed; a separate append-only
 * void row says it no longer counts, from the moment of the void on. Voiding twice is the same void (the first reason stands).
 * A new acknowledgment of the same content can be recorded afterward. The audit entry holds ids only; the reason does not
 * leave the void row (and the payload read behind VIEW_SENSITIVE_DATA).
 */
export async function voidAcknowledgmentEvidence(input: {
  eventId: string;
  registrationId: string;
  evidenceId: string;
  reason: string;
  actorUserId: string;
}): Promise<VoidOutcome> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 1000) {
    throw new AcknowledgmentError("REASON_REQUIRED", "Enter a reason of 1 to 1,000 characters for voiding this acknowledgment.");
  }
  return getPrisma().$transaction(async (tx) => {
    const evidence = await tx.acknowledgmentEvidence.findFirst({
      where: { id: input.evidenceId, eventId: input.eventId, registrationId: input.registrationId },
      select: { id: true, fieldKey: true, registrationAttendeeId: true },
    });
    if (!evidence) throw new AcknowledgmentError("EVIDENCE_NOT_FOUND", "That acknowledgment evidence was not found.");
    const existing = await tx.acknowledgmentVoid.findUnique({ where: { evidenceId: evidence.id }, select: { id: true, evidenceId: true, voidedAt: true } });
    if (existing) return { void: { id: existing.id, evidenceId: existing.evidenceId, voidedAt: existing.voidedAt.toISOString() }, created: false };
    const id = randomUUID();
    const inserted = await tx.acknowledgmentVoid.createMany({
      skipDuplicates: true,
      data: [{ id, eventId: input.eventId, registrationId: input.registrationId, evidenceId: evidence.id, voidedByUserId: input.actorUserId, reason }],
    });
    const row = await tx.acknowledgmentVoid.findUniqueOrThrow({ where: { evidenceId: evidence.id }, select: { id: true, evidenceId: true, voidedAt: true } });
    if (inserted.count === 1) {
      await writeAuditLog({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "ACKNOWLEDGMENT_VOIDED",
        entityType: "AcknowledgmentVoid",
        entityId: row.id,
        summary: "Voided an acknowledgment.",
        // Ids only: the reason stays on the void row.
        metadata: { eventId: input.eventId, registrationId: input.registrationId, evidenceId: evidence.id, registrationAttendeeId: evidence.registrationAttendeeId, fieldKey: evidence.fieldKey },
      }, tx);
    }
    return { void: { id: row.id, evidenceId: row.evidenceId, voidedAt: row.voidedAt.toISOString() }, created: inserted.count === 1 };
  });
}

export type WithdrawalOutcome = {
  withdrawal: { id: string; evidenceId: string; withdrawnAt: string; channel: AcknowledgmentChannel };
  created: boolean;
  replayed: boolean;
};

/**
 * A withdrawal (#130): staff record that a person withdrew an earlier acceptance. It is a new append-only record naming the
 * acceptance; the acceptance row is never touched and stays the evidence of what the person agreed to before `withdrawnAt`.
 *
 * Who may withdraw follows who may acknowledge for that subject: the subject themselves, or for a minor their declared
 * responsible adult. Staff cannot stand in. A voided acceptance, or a decline, cannot be withdrawn. A second withdrawal of the
 * same acceptance (same request id or not) returns the one already on file. The audit entry holds ids only; the paper location
 * stays on the withdrawal row (and in the payload read behind VIEW_SENSITIVE_DATA).
 */
export async function withdrawAcknowledgmentEvidence(input: {
  eventId: string;
  registrationId: string;
  evidenceId: string;
  channel: "STAFF_ENTERED" | "PAPER";
  /** Who withdrew. Defaults to the registrant for a registration-level field and to the attendee themselves otherwise. */
  actedByPersonId?: string | null;
  /** When it took effect; defaults to now, never in the future, never before the acceptance. */
  withdrawnAt?: Date | null;
  paperLocation?: string | null;
  clientRequestId: string;
  actorUserId: string;
}, now = new Date()): Promise<WithdrawalOutcome> {
  const location = normalizePaperLocation(input.channel, input.paperLocation);
  if (!location.ok) throw new AcknowledgmentError(location.code, location.message);
  const withdrawnAt = input.withdrawnAt ?? now;
  if (withdrawnAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new AcknowledgmentError("WITHDRAWN_AT_INVALID", "The withdrawal date cannot be in the future.");
  }
  const idempotencyKey = staffEvidenceKey(input.clientRequestId);
  return getPrisma().$transaction(async (tx) => {
    const evidence = await tx.acknowledgmentEvidence.findFirst({
      where: { id: input.evidenceId, eventId: input.eventId, registrationId: input.registrationId },
      select: {
        id: true, action: true, fieldKey: true, registrationAttendeeId: true, subjectPersonId: true, subjectMinorStatus: true, acknowledgedAt: true,
        void: { select: { voidedAt: true } },
      },
    });
    if (!evidence) throw new AcknowledgmentError("EVIDENCE_NOT_FOUND", "That acknowledgment evidence was not found.");
    await lockSubjectField(tx, input.registrationId, evidence.registrationAttendeeId, evidence.fieldKey);

    // A retry replays the first result before anything else is judged, even if the acceptance has since been voided.
    const requestHash = withdrawalRequestHash({
      eventId: input.eventId, registrationId: input.registrationId, evidenceId: evidence.id, actedByPersonId: input.actedByPersonId ?? null, channel: input.channel, paperLocation: location.value,
    });
    const keyed = await tx.acknowledgmentWithdrawal.findUnique({
      where: { eventId_idempotencyKey: { eventId: input.eventId, idempotencyKey } },
      select: { id: true, evidenceId: true, withdrawnAt: true, channel: true, requestHash: true },
    });
    if (keyed) {
      if (keyed.requestHash !== requestHash || keyed.evidenceId !== evidence.id) {
        throw new AcknowledgmentError("IDEMPOTENCY_CONFLICT", "That request id was already used for a different withdrawal.");
      }
      return { withdrawal: summarizeWithdrawal(keyed), created: false, replayed: true };
    }
    // Withdrawing twice is the same withdrawal: the first stands.
    const existing = await tx.acknowledgmentWithdrawal.findUnique({
      where: { evidenceId: evidence.id },
      select: { id: true, evidenceId: true, withdrawnAt: true, channel: true },
    });
    if (existing) return { withdrawal: summarizeWithdrawal(existing), created: false, replayed: false };

    if (evidence.action !== "ACKNOWLEDGE") {
      throw new AcknowledgmentError("EVIDENCE_NOT_WITHDRAWABLE", "Only an acknowledgment can be withdrawn. A decline stands as recorded.");
    }
    if (evidence.void) {
      throw new AcknowledgmentError("EVIDENCE_VOIDED", "That acknowledgment was voided, so there is nothing to withdraw.");
    }
    if (withdrawnAt.getTime() < evidence.acknowledgedAt.getTime()) {
      throw new AcknowledgmentError("WITHDRAWN_AT_INVALID", "The withdrawal date cannot be before the acknowledgment it withdraws.");
    }

    const registration = await tx.registration.findFirst({
      where: { id: input.registrationId, eventId: input.eventId },
      select: {
        accountHolderPersonId: true,
        event: { select: { startsAt: true, timezone: true, ageOfMajority: true } },
        attendees: { select: { id: true, personId: true, formResponses: true, profileSnapshot: true } },
      },
    });
    if (!registration) throw new AcknowledgmentError("REGISTRATION_NOT_FOUND", "That registration was not found for this event.");
    // The subject's standing on the event's start date, read as acknowledging reads it; an attendee removed since falls back to what was recorded.
    const attendeeRow = evidence.registrationAttendeeId ? registration.attendees.find((candidate) => candidate.id === evidence.registrationAttendeeId) : null;
    const subjectStatus: MinorStatus["status"] = attendeeRow
      ? minorStatusAt(
          personAgeFromAnswers(record(attendeeRow.formResponses), record(attendeeRow.profileSnapshot)),
          eventStartDate(registration.event.startsAt, registration.event.timezone),
          registration.event.ageOfMajority,
        ).status
      : (["MINOR", "ADULT", "UNKNOWN"] as const).find((status) => status === evidence.subjectMinorStatus) ?? "ADULT";
    const actedByPersonId = input.actedByPersonId ?? evidence.subjectPersonId ?? registration.accountHolderPersonId;
    const onRegistration = actedByPersonId === registration.accountHolderPersonId
      || registration.attendees.some((candidate) => candidate.personId === actedByPersonId)
      || actedByPersonId === evidence.subjectPersonId;
    if (!onRegistration) throw new AcknowledgmentError("ACTOR_NOT_FOUND", "The person who withdrew is not on this registration.");
    const authority = evidence.subjectPersonId && subjectStatus === "MINOR"
      ? await findActiveDeclaredAuthority(tx, input.eventId, evidence.subjectPersonId, input.registrationId)
      : null;
    const decision: ActingDecision = decideActing({
      subject: { personId: evidence.subjectPersonId, status: subjectStatus },
      actedByPersonId,
      authority,
    });
    if (!decision.allowed) throw new AcknowledgmentError(decision.code, decision.message);

    const id = randomUUID();
    const inserted = await tx.acknowledgmentWithdrawal.createMany({
      skipDuplicates: true,
      data: [{
        id,
        eventId: input.eventId,
        registrationId: input.registrationId,
        evidenceId: evidence.id,
        actedByPersonId,
        recordedByUserId: input.actorUserId,
        channel: input.channel,
        subjectMinorStatus: subjectStatus,
        guardianAuthorityId: decision.guardianAuthorityId,
        paperLocation: location.value,
        withdrawnAt,
        idempotencyKey,
        requestHash,
      }],
    });
    if (inserted.count === 0) {
      // Lost a race to another withdrawal of this acceptance: whatever won is the withdrawal.
      const winner = await tx.acknowledgmentWithdrawal.findUnique({
        where: { evidenceId: evidence.id },
        select: { id: true, evidenceId: true, withdrawnAt: true, channel: true },
      });
      if (!winner) throw new AcknowledgmentError("IDEMPOTENCY_CONFLICT", "That withdrawal could not be recorded. Try again.");
      return { withdrawal: summarizeWithdrawal(winner), created: false, replayed: false };
    }
    const row = await tx.acknowledgmentWithdrawal.findUniqueOrThrow({
      where: { id },
      select: { id: true, evidenceId: true, withdrawnAt: true, channel: true },
    });
    await writeAuditLog({
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "ACKNOWLEDGMENT_WITHDRAWN",
      entityType: "AcknowledgmentWithdrawal",
      entityId: id,
      summary: `Recorded a withdrawn acknowledgment (${input.channel.toLowerCase().replace("_", " ")}).`,
      // Ids and flags only: never the wording, the paper location or the request id.
      metadata: {
        eventId: input.eventId,
        registrationId: input.registrationId,
        evidenceId: evidence.id,
        registrationAttendeeId: evidence.registrationAttendeeId,
        fieldKey: evidence.fieldKey,
        channel: input.channel,
        subjectMinorStatus: subjectStatus,
        guardianAuthorityId: decision.guardianAuthorityId,
      },
    }, tx);
    return { withdrawal: summarizeWithdrawal(row), created: true, replayed: false };
  });
}

function summarizeWithdrawal(row: { id: string; evidenceId: string; withdrawnAt: Date; channel: AcknowledgmentChannel }) {
  return { id: row.id, evidenceId: row.evidenceId, withdrawnAt: row.withdrawnAt.toISOString(), channel: row.channel };
}

/** How many evidence rows an event holds (counts only), for the event deletion guard. */
export async function countAcknowledgmentEvidence(client: Client, eventId: string) {
  return client.acknowledgmentEvidence.count({ where: { eventId } });
}
