import "server-only";

import { ConsentPolicyVersionStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  applicabilityMatches,
  consentPolicyInputSchema,
  consentPolicyPublishInputSchema,
  consentPolicyVersionContentSchema,
  contentHashFor,
  policyApplicabilityInputSchema,
  mergeApplicabilityUpdate,
  policyApplicabilityUpdateSchema,
  requirePolicyKind,
  type PolicyKind,
  policyKinds,
  selectEffectiveVersion,
  type ApplicabilitySubject,
} from "@/modules/consent/domain";

/** How far before the publish moment an effective-from may be, to absorb browser-to-server delay. */
export const BACKDATE_TOLERANCE_MS = 5 * 60_000;

export class ConsentPolicyError extends Error {
  constructor(
    public readonly code:
      | "POLICY_NOT_FOUND"
      | "SLUG_TAKEN"
      | "VERSION_NOT_FOUND"
      | "VERSION_IMMUTABLE"
      | "DRAFT_EXISTS"
      | "NO_DRAFT"
      | "MATERIAL_CHANGE_REQUIRED"
      | "APPLICABILITY_NOT_FOUND"
      | "ATTENDEE_TYPE_NOT_FOUND"
      | "EFFECTIVE_FROM_IN_PAST",
    message: string,
  ) {
    super(message);
    this.name = "ConsentPolicyError";
  }
}

const createPolicyRequestSchema = z.object({
  kind: z.enum(policyKinds),
  slug: z.string(),
  name: z.string(),
  title: z.string(),
  bodyText: z.string(),
});

function slugConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConsentPolicyError("SLUG_TAKEN", "A policy with this slug already exists in this scope.");
  }
  throw error;
}

function draftConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConsentPolicyError("DRAFT_EXISTS", "This policy already has a draft version. Edit or publish it first.");
  }
  throw error;
}

/**
 * Ownership filter. `eventId` null addresses organization-scoped policies
 * only; an event id addresses only that event's own policies. Event staff can
 * therefore never author or publish an organization-wide policy, nor another
 * event's policy, through an event-scoped caller.
 */
function ownedPolicyWhere(eventId: string | null, policyId: string): Prisma.ConsentPolicyWhereInput {
  return { id: policyId, eventId };
}

const versionSummarySelect = {
  id: true,
  versionNumber: true,
  status: true,
  title: true,
  bodyText: true,
  contentHash: true,
  effectiveFrom: true,
  effectiveTo: true,
  isMaterialChange: true,
  publishedAt: true,
  publishedBy: { select: { id: true, displayName: true } },
  createdAt: true,
  updatedAt: true,
} as const;

type PolicyVersionRow = Prisma.ConsentPolicyVersionGetPayload<{ select: typeof versionSummarySelect }>;

function serializeVersion(version: PolicyVersionRow) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title,
    bodyText: version.bodyText,
    contentHash: version.contentHash,
    effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
    effectiveTo: version.effectiveTo?.toISOString() ?? null,
    isMaterialChange: version.isMaterialChange,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    publishedBy: version.publishedBy,
    updatedAt: version.updatedAt.toISOString(),
  };
}

const policyInclude = {
  versions: { select: versionSummarySelect, orderBy: { versionNumber: "desc" as const } },
} as const;

type PolicyRow = Prisma.ConsentPolicyGetPayload<{ include: typeof policyInclude }>;

function serializePolicy(policy: PolicyRow) {
  return {
    id: policy.id,
    eventId: policy.eventId,
    kind: policy.kind,
    scope: policy.scope,
    slug: policy.slug,
    name: policy.name,
    currentVersionId: policy.currentVersionId,
    versions: policy.versions.map(serializeVersion),
  };
}

/** An event's own policies (every version, drafts included) plus every organization-scoped policy, which the
 * event can reference in its applicability configuration. An organization policy's unpublished drafts belong to
 * whoever authors it and are never shown to an event: only its published versions are. */
export async function listConsentPoliciesForEvent(eventId: string) {
  const prisma = getPrisma();
  const [own, organization] = await Promise.all([
    prisma.consentPolicy.findMany({ where: { eventId }, include: policyInclude }),
    prisma.consentPolicy.findMany({
      where: { eventId: null },
      include: { versions: { ...policyInclude.versions, where: { status: ConsentPolicyVersionStatus.PUBLISHED } } },
    }),
  ]);
  return [...own, ...organization]
    .sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name))
    .map(serializePolicy);
}

const slimVersionSelect = {
  id: true,
  versionNumber: true,
  title: true,
  contentHash: true,
  effectiveFrom: true,
  effectiveTo: true,
  policy: { select: { id: true, kind: true, scope: true, slug: true, name: true } },
} as const;

/**
 * Read for form builders (#150): published versions only, with no body text, for the event's own policies and
 * organization-scoped ones. Drafts never appear, and neither does another event's policy.
 */
export async function listPublishedPolicyVersionsForEvent(eventId: string) {
  const versions = await getPrisma().consentPolicyVersion.findMany({
    where: { status: ConsentPolicyVersionStatus.PUBLISHED, policy: { OR: [{ eventId }, { eventId: null }] } },
    select: slimVersionSelect,
    orderBy: [{ policy: { name: "asc" } }, { versionNumber: "desc" }],
  });
  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    kind: version.policy.kind,
    title: version.title,
    contentHash: version.contentHash,
    effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
    effectiveTo: version.effectiveTo?.toISOString() ?? null,
    policy: version.policy,
  }));
}

/**
 * Creates the policy definition together with its first DRAFT version.
 * `eventId` null creates an organization-scoped policy; callers exposing this
 * to event staff must always pass their own event id.
 */
export async function createConsentPolicy(eventId: string | null, actorUserId: string, rawInput: unknown) {
  const request = createPolicyRequestSchema.parse(rawInput);
  const input = consentPolicyInputSchema.parse({
    kind: request.kind,
    scope: eventId === null ? "ORGANIZATION" : "EVENT",
    eventId,
    slug: request.slug,
    name: request.name,
  });
  const content = consentPolicyVersionContentSchema.parse({ title: request.title, bodyText: request.bodyText });
  try {
    return await getPrisma().$transaction(async (tx) => {
      const policy = await tx.consentPolicy.create({
        data: {
          ...input,
          createdByUserId: actorUserId,
          versions: { create: { createdByUserId: actorUserId, versionNumber: 1, ...content } },
        },
        include: policyInclude,
      });
      await writeAuditLog({
        eventId: eventId ?? undefined, actorUserId, action: "CONSENT_POLICY_CREATED", entityType: "ConsentPolicy", entityId: policy.id, summary: "Created a consent policy.",
        metadata: { kind: policy.kind, scope: policy.scope },
    }, tx);
      return serializePolicy(policy);
    });
  } catch (error) { return slugConflict(error); }
}

/**
 * Starts the next DRAFT version from staff-entered content. Only one draft
 * may exist at a time (also enforced by a partial unique index). Published
 * versions are untouched: a correction is always a new version.
 */
export async function createNextDraftVersion(eventId: string | null, policyId: string, actorUserId: string, rawContent: unknown) {
  const content = consentPolicyVersionContentSchema.parse(rawContent);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const policy = await tx.consentPolicy.findFirst({
        where: ownedPolicyWhere(eventId, policyId),
        include: { versions: { select: { versionNumber: true, status: true }, orderBy: { versionNumber: "desc" } } },
      });
      if (!policy) throw new ConsentPolicyError("POLICY_NOT_FOUND", "That policy was not found.");
      if (policy.versions.some((version) => version.status === ConsentPolicyVersionStatus.DRAFT)) {
        throw new ConsentPolicyError("DRAFT_EXISTS", "This policy already has a draft version. Edit or publish it first.");
      }
      const version = await tx.consentPolicyVersion.create({
        data: {
          policyId,
          createdByUserId: actorUserId,
          versionNumber: (policy.versions[0]?.versionNumber ?? 0) + 1,
          ...content,
        },
        select: versionSummarySelect,
      });
      await writeAuditLog({
        eventId: eventId ?? undefined, actorUserId, action: "CONSENT_POLICY_DRAFT_CREATED", entityType: "ConsentPolicyVersion", entityId: version.id, summary: "Started a draft policy version.",
        metadata: { policyId, versionNumber: version.versionNumber },
    }, tx);
      return serializeVersion(version);
    });
  } catch (error) { return draftConflict(error); }
}

/**
 * Edits a DRAFT version's content in place — the only code path that writes
 * version content. The write itself is conditioned on `status = DRAFT`, so a
 * version published between the read and the write is still refused (the
 * update matches zero rows). A database trigger rejects any UPDATE of a
 * published row as a second line of defense.
 */
export async function updateDraftPolicyVersion(
  eventId: string | null,
  policyId: string,
  versionId: string,
  actorUserId: string,
  rawContent: unknown,
) {
  const content = consentPolicyVersionContentSchema.parse(rawContent);
  return getPrisma().$transaction(async (tx) => {
    const version = await tx.consentPolicyVersion.findFirst({
      where: { id: versionId, policy: ownedPolicyWhere(eventId, policyId) },
      select: { id: true, status: true, versionNumber: true },
    });
    if (!version) throw new ConsentPolicyError("VERSION_NOT_FOUND", "That policy version was not found.");
    const refused = new ConsentPolicyError(
      "VERSION_IMMUTABLE",
      "Published policy versions cannot be changed. Start a new draft to correct this policy.",
    );
    if (version.status !== ConsentPolicyVersionStatus.DRAFT) throw refused;
    const { count } = await tx.consentPolicyVersion.updateMany({
      where: { id: versionId, policyId, status: ConsentPolicyVersionStatus.DRAFT, publishedAt: null },
      data: content,
    });
    if (count !== 1) throw refused;
    await writeAuditLog({
      eventId: eventId ?? undefined, actorUserId, action: "CONSENT_POLICY_DRAFT_SAVED", entityType: "ConsentPolicyVersion", entityId: versionId, summary: "Saved a draft policy version.",
      metadata: { policyId, versionNumber: version.versionNumber },
    }, tx);
    return serializeVersion(await tx.consentPolicyVersion.findUniqueOrThrow({ where: { id: versionId }, select: versionSummarySelect }));
  });
}

/**
 * Freezes the policy's DRAFT version. Previously published versions are left
 * exactly as they are — no status change, no end-date back-fill — so every
 * version anyone has seen stays selectable by date and referenceable by
 * evidence. The publisher must state whether this version materially changes
 * obligations for every publication.
 */
export async function publishPolicyVersion(eventId: string | null, policyId: string, actorUserId: string, rawInput: unknown) {
  const input = consentPolicyPublishInputSchema.parse(rawInput);
  const publishedAt = new Date();
  // A version cannot take effect before it is published: backdating would rewrite which text applied to
  // evidence that already exists. "Effective now" sent from a browser reaches the server a little late, so up to
  // BACKDATE_TOLERANCE_MS before the publish moment is accepted (and stored as sent).
  if (input.effectiveFrom.getTime() < publishedAt.getTime() - BACKDATE_TOLERANCE_MS) {
    throw new ConsentPolicyError("EFFECTIVE_FROM_IN_PAST", "The effective-from date cannot be earlier than the moment of publishing (a 5-minute allowance for clock delay aside). Choose now or a later date.");
  }
  return getPrisma().$transaction(async (tx) => {
    const policy = await tx.consentPolicy.findFirst({
      where: ownedPolicyWhere(eventId, policyId),
      include: { versions: { select: { id: true, status: true, title: true, bodyText: true, versionNumber: true } } },
    });
    if (!policy) throw new ConsentPolicyError("POLICY_NOT_FOUND", "That policy was not found.");
    const draft = policy.versions.find((version) => version.status === ConsentPolicyVersionStatus.DRAFT);
    if (!draft) throw new ConsentPolicyError("NO_DRAFT", "This policy has no draft version to publish.");
    // Guard the state transition with the exact content we hash below. If a
    // draft edit wins the race after the read, this update matches nothing and
    // we refuse to publish rather than freezing a hash for stale text.
    const { count } = await tx.consentPolicyVersion.updateMany({
      where: {
        id: draft.id,
        status: ConsentPolicyVersionStatus.DRAFT,
        publishedAt: null,
        title: draft.title,
        bodyText: draft.bodyText,
      },
      data: {
        status: ConsentPolicyVersionStatus.PUBLISHED,
        publishedAt,
        publishedByUserId: actorUserId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        isMaterialChange: input.isMaterialChange,
        contentHash: contentHashFor({ title: draft.title, bodyText: draft.bodyText }),
      },
    });
    if (count !== 1) throw new ConsentPolicyError("NO_DRAFT", "This draft was changed or already published. Reload it before publishing.");
    await tx.consentPolicy.update({ where: { id: policyId }, data: { currentVersionId: draft.id } });
    await writeAuditLog({
      eventId: eventId ?? undefined, actorUserId, action: "CONSENT_POLICY_PUBLISHED", entityType: "ConsentPolicyVersion", entityId: draft.id, summary: "Published a policy version.",
      metadata: {
        policyId,
        versionNumber: draft.versionNumber,
        isMaterialChange: input.isMaterialChange,
        effectiveFrom: input.effectiveFrom.toISOString(),
        effectiveTo: input.effectiveTo?.toISOString() ?? null,
      },
    }, tx);
    return serializeVersion(await tx.consentPolicyVersion.findUniqueOrThrow({ where: { id: draft.id }, select: versionSummarySelect }));
  });
}

/** A policy is reachable from an event only when it is the event's own or organization-scoped. */
const reachableFromEvent = (eventId: string) => ({ OR: [{ eventId }, { eventId: null }] });

/**
 * Presentation query: the published version effective at `atDate`, resolved
 * by effective window — never "highest version number" and never a draft.
 * Deliberately separate from `getPolicyVersionForEvidence`: "what applies at
 * this moment" and "what did this person actually see" are different
 * questions and must not share a query. Scoped to an event: another event's
 * policy answers not-found. Pass `expectedKind` to refuse a policy of another kind.
 * Returns null when the policy has no version effective at that date.
 */
export async function getPolicyVersionEffectiveAt(eventId: string, policyId: string, atDate: Date, expectedKind?: PolicyKind) {
  const policy = await getPrisma().consentPolicy.findFirst({
    where: { id: policyId, ...reachableFromEvent(eventId) },
    select: { id: true, kind: true, scope: true, eventId: true },
  });
  if (!policy) throw new ConsentPolicyError("POLICY_NOT_FOUND", "That policy was not found for this event.");
  if (expectedKind) requirePolicyKind(policy, expectedKind);
  const versions = await getPrisma().consentPolicyVersion.findMany({
    where: {
      policyId,
      status: ConsentPolicyVersionStatus.PUBLISHED,
      effectiveFrom: { lte: atDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: atDate } }],
    },
    select: versionSummarySelect,
  });
  const selected = selectEffectiveVersion(versions, atDate);
  return selected ? { ...serializeVersion(selected), policy } : null;
}

/**
 * Evidence query: the exact published version an evidence row references, by
 * id. Never falls back to "latest" or "effective now" — evidence must resolve
 * to what a person actually saw even after later corrections take effect.
 * Drafts are never valid evidence targets, and a version of another event's
 * policy is not found. Pass `expectedKind` to refuse a policy of another kind.
 */
export async function getPolicyVersionForEvidence(eventId: string, versionId: string, expectedKind?: PolicyKind) {
  const version = await getPrisma().consentPolicyVersion.findFirst({
    where: { id: versionId, status: ConsentPolicyVersionStatus.PUBLISHED, policy: reachableFromEvent(eventId) },
    select: { ...versionSummarySelect, policy: { select: { id: true, kind: true, scope: true, eventId: true } } },
  });
  if (!version) throw new ConsentPolicyError("VERSION_NOT_FOUND", "That published policy version was not found.");
  if (expectedKind) requirePolicyKind(version.policy, expectedKind);
  return { ...serializeVersion(version), policy: version.policy };
}

const applicabilityInclude = {
  policy: { select: { id: true, kind: true, scope: true, slug: true, name: true, eventId: true, currentVersionId: true } },
  attendeeTypeDefinition: { select: { id: true, code: true, label: true } },
} as const;

type ApplicabilityRow = Prisma.EventConsentPolicyApplicabilityGetPayload<{ include: typeof applicabilityInclude }>;

function serializeApplicability(row: ApplicabilityRow) {
  return {
    id: row.id,
    policy: row.policy,
    attendeeType: row.attendeeTypeDefinition,
    attendeeTypeDefinitionId: row.attendeeTypeDefinitionId,
    role: row.role,
    minimumAge: row.minimumAge,
    maximumAge: row.maximumAge,
    isRequired: row.isRequired,
    isActive: row.isActive,
  };
}

export async function listEventPolicyApplicabilities(eventId: string, activeOnly = false) {
  const rows = await getPrisma().eventConsentPolicyApplicability.findMany({
    where: { eventId, ...(activeOnly ? { isActive: true } : {}) },
    include: applicabilityInclude,
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(serializeApplicability);
}

async function assertAttendeeTypeInEvent(tx: Prisma.TransactionClient, eventId: string, attendeeTypeDefinitionId: string | null) {
  if (attendeeTypeDefinitionId === null) return;
  const type = await tx.eventAttendeeType.findFirst({ where: { id: attendeeTypeDefinitionId, eventId }, select: { id: true } });
  if (!type) throw new ConsentPolicyError("ATTENDEE_TYPE_NOT_FOUND", "That attendee type was not found for this event.");
}

/** Configures a policy for an event. The policy must be this event's own or
 * organization-scoped; the database trigger enforces the same rule. */
export async function createEventPolicyApplicability(eventId: string, actorUserId: string, rawInput: unknown) {
  const input = policyApplicabilityInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    const policy = await tx.consentPolicy.findFirst({
      where: { id: input.policyId, OR: [{ eventId }, { eventId: null }] },
      select: { id: true, name: true },
    });
    if (!policy) throw new ConsentPolicyError("POLICY_NOT_FOUND", "That policy was not found for this event.");
    await assertAttendeeTypeInEvent(tx, eventId, input.attendeeTypeDefinitionId);
    const created = await tx.eventConsentPolicyApplicability.create({
      data: { eventId, ...input },
      include: applicabilityInclude,
    });
    await writeAuditLog({
      eventId, actorUserId, action: "CONSENT_POLICY_APPLICABILITY_CREATED", entityType: "EventConsentPolicyApplicability", entityId: created.id, summary: "Applied a policy to this event.",
      metadata: { policyId: policy.id, isRequired: created.isRequired },
    }, tx);
    return serializeApplicability(created);
  });
}

export async function updateEventPolicyApplicability(eventId: string, applicabilityId: string, actorUserId: string, rawInput: unknown) {
  const input = policyApplicabilityUpdateSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.eventConsentPolicyApplicability.findFirst({
      where: { id: applicabilityId, eventId },
      select: { id: true, policyId: true, minimumAge: true, maximumAge: true },
    });
    if (!existing) throw new ConsentPolicyError("APPLICABILITY_NOT_FOUND", "That policy configuration was not found for this event.");
    // Only the fields the caller named are written; the age band is checked on the merged values.
    const changes = mergeApplicabilityUpdate(existing, input);
    if (changes.attendeeTypeDefinitionId !== undefined) await assertAttendeeTypeInEvent(tx, eventId, changes.attendeeTypeDefinitionId);
    const updated = await tx.eventConsentPolicyApplicability.update({
      where: { id: applicabilityId },
      data: changes,
      include: applicabilityInclude,
    });
    await writeAuditLog({
      eventId, actorUserId, action: "CONSENT_POLICY_APPLICABILITY_UPDATED", entityType: "EventConsentPolicyApplicability", entityId: applicabilityId, summary: "Updated a policy configuration for this event.",
      metadata: { policyId: existing.policyId, isRequired: updated.isRequired, isActive: updated.isActive },
    }, tx);
    return serializeApplicability(updated);
  });
}

/**
 * Which policies apply to one attendee of an event, and whether agreement is
 * required to proceed. Age bands are evaluated on the event start date. When
 * several active rows for the same policy match, the policy is required if any
 * matching row requires it.
 */
export async function resolveApplicablePolicies(eventId: string, subject: ApplicabilitySubject) {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { startsAt: true } });
  if (!event) return [];
  const rows = await prisma.eventConsentPolicyApplicability.findMany({
    where: { eventId, isActive: true },
    include: applicabilityInclude,
    orderBy: [{ createdAt: "asc" }],
  });
  const byPolicy = new Map<string, { policy: ApplicabilityRow["policy"]; isRequired: boolean }>();
  for (const row of rows) {
    if (!applicabilityMatches(row, subject, event.startsAt)) continue;
    const existing = byPolicy.get(row.policyId);
    byPolicy.set(row.policyId, { policy: row.policy, isRequired: (existing?.isRequired ?? false) || row.isRequired });
  }
  return [...byPolicy.values()];
}
