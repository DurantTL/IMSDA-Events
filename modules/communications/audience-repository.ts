import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import {
  AUDIENCE_QUERY_VERSION,
  AudienceFilterNotAvailableError,
  assertQueryAvailable,
  audienceQueryHash,
  audienceSearchQuery,
  describeAvailableFilters,
  normalizeAudienceQuery,
  searchViewerFor,
  type AudienceCapabilities,
  type AudienceDomain,
  type NormalizedAudienceQuery,
} from "@/modules/communications/audience-query";
import {
  AudienceAccumulator,
  buildSearchReasons,
  audiencePageSchema,
  pageAudienceList,
  type AudiencePageInput,
  type AudienceRegistrationRow,
  type AudienceResult,
  type AudienceSuppressionCode,
} from "@/modules/communications/audience-resolve";
import { loadAnnouncementOptOuts } from "@/modules/communications/email-preferences-repository";
import { announcementOptOutFor } from "@/modules/communications/email-preferences";
import { MessagingError } from "@/modules/communications/messaging-error";
import {
  enumerateOperationsRegistrationIds,
  loadOperationsSearchCatalog,
} from "@/modules/registrations/operations-search-repository";

/**
 * The reviewed event audience builder's loader and snapshot (#176). It extends the WR26 messaging services: it reads
 * the same registration contact, balance and opt-out facts they do, and the snapshot follows their review pattern (a
 * client UUID plus the server's fingerprint; a lost-response replay returns the original, a changed audience is refused).
 *
 * Preview only. Nothing here writes a message, a batch or a schedule. The one write is the audited snapshot, which
 * records the normalized query, its version, the fingerprint and counts, and holds no recipient.
 *
 * WHICH registrations are in the audience is the operations search (#180): `enumerateOperationsRegistrationIds` runs the
 * query's canonical `search` through the same `prepare` and `readWhere` as the staff lists, for this caller's own
 * permissions, so a filter the caller may not use is refused before anything is read and health and sensitive answers
 * are unsearchable. This module then loads the matched ids in batches and decides who on each registration is written to.
 *
 * The loader selects an explicit list of columns. It never reads a registration or attendee profile snapshot, form
 * answers (existence is checked in the database, the content is never loaded), health records, screening or consent
 * evidence, note rows, or event membership, so none of it can qualify or appear in a preview.
 */

const DEFAULT_BATCH_SIZE = 250;
const SUPPRESSION_CHUNK = 500;

type Client = ReturnType<typeof getPrisma> | Prisma.TransactionClient;

function recordFromJson(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function moneyToCents(value: { toString(): string } | number) {
  return Math.round(Number(value.toString()) * 100);
}

function personName(person: { firstName: string; lastName: string }) {
  return `${person.firstName} ${person.lastName}`.trim();
}

export async function loadAudienceDomains(eventId: string, client: Client = getPrisma()): Promise<Set<AudienceDomain>> {
  const domains = new Set<AudienceDomain>(["REGISTRATION"]);
  const [event, group, club, responsibility] = await Promise.all([
    client.event.findUnique({ where: { id: eventId }, select: { audience: true } }),
    client.groupEventRegistration.findFirst({ where: { eventId }, select: { id: true } }),
    client.clubEventRegistration.findFirst({ where: { eventId }, select: { id: true } }),
    client.registrationBillingResponsibility.findFirst({
      where: { eventId, organizationId: { not: null } },
      select: { id: true },
    }),
  ]);
  if (!event) throw new MessagingError("MESSAGE_NOT_FOUND", "That event is no longer available.");
  if (group) domains.add("GROUPS");
  if (event.audience === "CLUB" || club || responsibility) domains.add("ORGANIZATIONS");
  return domains;
}

export async function getAudienceCapabilities(
  eventId: string,
  permissions: readonly string[],
  client: Client = getPrisma(),
): Promise<AudienceCapabilities> {
  return { permissions: new Set(permissions), domains: await loadAudienceDomains(eventId, client) };
}

/** The filters this caller may compose: the operations-search filters they may use, the roles the event has, and readiness. */
export async function getAudienceFilterOptions(eventId: string, permissions: readonly string[]) {
  const capabilities = await getAudienceCapabilities(eventId, permissions);
  const viewer = searchViewerFor(eventId, permissions);
  const catalog = await loadOperationsSearchCatalog(viewer);
  return {
    sourceQueryVersion: AUDIENCE_QUERY_VERSION,
    ...describeAvailableFilters(viewer, catalog, capabilities),
  };
}

async function loadSuppressions(
  client: Client,
  eventId: string,
  query: NormalizedAudienceQuery,
  emails: readonly string[],
) {
  const suppressions = new Map<string, AudienceSuppressionCode>();
  for (let offset = 0; offset < emails.length; offset += SUPPRESSION_CHUNK) {
    const chunk = emails.slice(offset, offset + SUPPRESSION_CHUNK);
    // Provider suppression (a bounce or a spam complaint as the address's latest delivery state) applies to every kind.
    const latest = await client.messageOutbox.findMany({
      where: { recipientEmail: { in: chunk }, providerDeliveryStatus: { not: null }, providerStatusAt: { not: null } },
      orderBy: [{ providerStatusAt: "desc" }, { id: "asc" }],
      distinct: ["recipientEmail"],
      select: { recipientEmail: true, providerDeliveryStatus: true },
    });
    for (const row of latest) {
      if (row.providerDeliveryStatus === "BOUNCED") suppressions.set(row.recipientEmail.toLowerCase(), "PROVIDER_BOUNCED");
      else if (row.providerDeliveryStatus === "COMPLAINED") suppressions.set(row.recipientEmail.toLowerCase(), "PROVIDER_COMPLAINED");
    }
    // Only an announcement can be opted out of (#838).
    if (query.messageKind === "ANNOUNCEMENT") {
      const optOuts = await loadAnnouncementOptOuts(client, chunk, eventId);
      for (const email of chunk) {
        if (suppressions.has(email)) continue;
        const scope = announcementOptOutFor(optOuts, email, eventId);
        if (scope) suppressions.set(email, scope === "ALL" ? "OPTED_OUT_ALL" : "OPTED_OUT_EVENT");
      }
    }
  }
  return suppressions;
}

async function loadRegistrationBatch(
  client: Client,
  eventId: string,
  query: NormalizedAudienceQuery,
  registrationIds: readonly string[],
  now: Date,
): Promise<AudienceRegistrationRow[]> {
  const wantsOrganization = query.roles.includes("ORGANIZATION_CONTACT");
  const wantsGroup = query.roles.includes("GROUP_LEADER");
  const registrations = await client.registration.findMany({
    // The ids came from the permission-gated search; the event id is still the first guard on every read.
    where: { eventId, id: { in: [...registrationIds] } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      confirmationCode: true,
      status: true,
      totalAmount: true,
      contactSnapshot: true,
      accountHolderPerson: { select: { firstName: true, lastName: true, normalizedEmail: true } },
      publicFormSubmission: { select: { id: true } },
      payments: {
        where: { status: "SUCCEEDED" },
        select: { amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } },
      },
      tagAssignments: { where: { removedAt: null, tag: { isActive: true } }, select: { tagId: true } },
      attendees: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          attendeeTypeDefinition: { select: { code: true } },
          person: { select: { firstName: true, lastName: true, normalizedEmail: true } },
          tagAssignments: { where: { removedAt: null, tag: { isActive: true } }, select: { tagId: true } },
        },
      },
      ...(wantsGroup
        ? { groupRegistration: { select: { billingPerson: { select: { firstName: true, lastName: true, normalizedEmail: true } } } } }
        : {}),
      ...(wantsOrganization
        ? {
          clubRegistration: { select: { organizationId: true } },
          billingResponsibility: { select: { organizationId: true } },
        }
        : {}),
    },
  });
  if (registrations.length === 0) return [];

  // Existence of any answer, decided in the database: the answers themselves are never loaded.
  const attendeeIds = registrations.flatMap((registration) => registration.attendees.map((attendee) => attendee.id));
  const withResponses = new Set((await client.registrationAttendee.findMany({
    where: { id: { in: attendeeIds }, NOT: { formResponses: { equals: {} } } },
    select: { id: true },
  })).map((row) => row.id));

  // Only a verified, current organization billing contact is an approved organization contact.
  const contactByOrganization = new Map<string, { name: string; email: string }>();
  if (wantsOrganization) {
    const organizationIds = [...new Set(registrations.flatMap((registration) => {
      const row = registration as typeof registration & {
        clubRegistration?: { organizationId: string } | null;
        billingResponsibility?: { organizationId: string | null } | null;
      };
      return [row.clubRegistration?.organizationId, row.billingResponsibility?.organizationId];
    }).filter((id): id is string => Boolean(id)))];
    if (organizationIds.length > 0) {
      const contacts = await client.organizationBillingContact.findMany({
        where: {
          organizationId: { in: organizationIds },
          verifiedAt: { not: null },
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
        select: { organizationId: true, name: true, email: true },
      });
      for (const contact of contacts) {
        if (!contactByOrganization.has(contact.organizationId)) contactByOrganization.set(contact.organizationId, contact);
      }
    }
  }

  return registrations.map((registration) => {
    const snapshot = recordFromJson(registration.contactSnapshot);
    const text = (key: "firstName" | "lastName" | "email") => (
      typeof snapshot[key] === "string" ? (snapshot[key] as string).trim() : ""
    );
    const holder = registration.accountHolderPerson;
    const netPaidCents = registration.payments.reduce((total, payment) => (
      total + moneyToCents(payment.amount) - payment.refunds.reduce((sum, refund) => sum + moneyToCents(refund.amount), 0)
    ), 0);
    const extra = registration as typeof registration & {
      groupRegistration?: { billingPerson: { firstName: string; lastName: string; normalizedEmail: string | null } } | null;
      clubRegistration?: { organizationId: string } | null;
      billingResponsibility?: { organizationId: string | null } | null;
    };
    const organizationId = extra.clubRegistration?.organizationId ?? extra.billingResponsibility?.organizationId ?? null;
    const organizationContact = organizationId ? contactByOrganization.get(organizationId) ?? null : null;
    return {
      registrationId: registration.id,
      confirmationCode: registration.confirmationCode,
      status: registration.status,
      totalCents: moneyToCents(registration.totalAmount),
      netPaidCents,
      contact: {
        name: `${text("firstName") || holder.firstName} ${text("lastName") || holder.lastName}`.trim(),
        email: text("email") || holder.normalizedEmail,
      },
      hasPublicSubmission: Boolean(registration.publicFormSubmission),
      tagIds: registration.tagAssignments.map((assignment) => assignment.tagId),
      attendees: registration.attendees.map((attendee) => ({
        attendeeId: attendee.id,
        attendeeType: attendee.attendeeTypeDefinition?.code ?? "",
        name: personName(attendee.person),
        email: attendee.person.normalizedEmail,
        hasResponses: withResponses.has(attendee.id),
        tagIds: attendee.tagAssignments.map((assignment) => assignment.tagId),
      })),
      groupLeader: extra.groupRegistration
        ? { name: personName(extra.groupRegistration.billingPerson), email: extra.groupRegistration.billingPerson.normalizedEmail }
        : null,
      organizationContact,
    };
  });
}

export type AudienceEvaluationOptions = {
  batchSize?: number;
  now?: Date;
};

/**
 * Evaluates the whole audience. The operations search names the registrations (all of them, ids only, one snapshot, at
 * most its own paging bound); they are then loaded in batches, so memory holds one batch of registrations plus the
 * compact per-address summary, never every registration at once. The counts and fingerprint always cover the full
 * audience; paging only limits what is returned.
 *
 * Authorization comes first, before any read that could differ by what the event holds. An audience larger than the
 * search can enumerate is refused (AUDIENCE_TOO_BROAD) rather than truncated into one that looks complete.
 */
export async function evaluateEventAudience(
  eventId: string,
  permissions: readonly string[],
  rawQuery: unknown,
  options: AudienceEvaluationOptions = {},
): Promise<{ query: NormalizedAudienceQuery; queryHash: string; result: AudienceResult }> {
  const query = normalizeAudienceQuery(rawQuery);
  const prisma = getPrisma();
  const capabilities = await getAudienceCapabilities(eventId, permissions, prisma);
  assertQueryAvailable(query, capabilities);

  const viewer = searchViewerFor(eventId, permissions);
  const catalog = await loadOperationsSearchCatalog(viewer);
  const search = audienceSearchQuery(query);
  const selection = await enumerateOperationsRegistrationIds(viewer, search, catalog);
  if (!selection.ok) {
    if (selection.issues.length > 0 && selection.issues.every((issue) => issue.code === "too-broad")) {
      throw new MessagingError("AUDIENCE_TOO_BROAD", "That audience is too large to review at once. Narrow the filters and try again.");
    }
    // Unavailable, stale and invalid filters are all the same answer: it names no filter, value or count.
    throw new AudienceFilterNotAvailableError();
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { billingMode: true } });
  if (!event) throw new MessagingError("MESSAGE_NOT_FOUND", "That event is no longer available.");
  const accumulator = new AudienceAccumulator(query, {
    isOrganizationBilled: event.billingMode === "DEFERRED_ORGANIZATION_INVOICE",
    tagNames: new Map(catalog.tags.map((tag) => [tag.id, tag.name] as const)),
    attendeeTypeLabels: new Map(catalog.attendeeTypes.map((type) => [type.code, type.label] as const)),
    selection: { attendeeTypes: search.attendeeType, tagIds: search.tag },
    searchReasons: buildSearchReasons(search, catalog),
  }, eventId);

  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const now = options.now ?? new Date();
  for (let offset = 0; offset < selection.registrationIds.length; offset += batchSize) {
    const rows = await loadRegistrationBatch(prisma, eventId, query, selection.registrationIds.slice(offset, offset + batchSize), now);
    for (const row of rows) accumulator.consider(row);
  }

  const suppressions = await loadSuppressions(prisma, eventId, query, accumulator.emails());
  return { query, queryHash: audienceQueryHash(query), result: accumulator.finalize(suppressions) };
}

export const audiencePreviewRequestSchema = z.strictObject({
  query: z.unknown(),
  view: z.enum(["recipients", "exclusions"]).default("recipients"),
  page: audiencePageSchema.optional(),
});

export type AudiencePreviewRequest = {
  query: unknown;
  view?: "recipients" | "exclusions";
  page?: AudiencePageInput;
};

/** Paged counts and previews. Counts and the fingerprint describe the whole audience on every page. */
export async function previewEventAudience(
  eventId: string,
  permissions: readonly string[],
  request: AudiencePreviewRequest,
  options: AudienceEvaluationOptions = {},
) {
  const view = request.view ?? "recipients";
  const page = audiencePageSchema.parse(request.page ?? {});
  const { query, queryHash, result } = await evaluateEventAudience(eventId, permissions, request.query, options);
  const paged = view === "recipients"
    ? pageAudienceList(result.recipients, (recipient) => recipient.email, page)
    : pageAudienceList(result.exclusions, (exclusion) => exclusion.key, page);
  return {
    previewOnly: true as const,
    sourceQueryVersion: result.sourceQueryVersion,
    queryHash,
    query,
    fingerprint: result.fingerprint,
    generatedAt: (options.now ?? new Date()).toISOString(),
    counts: result.counts,
    view,
    items: paged.items,
    nextCursor: paged.nextCursor,
  };
}

export const audienceSnapshotInputSchema = z.strictObject({
  snapshotId: z.uuid(),
  query: z.unknown(),
  previewFingerprint: z.string().trim().length(64),
});

export type AudienceSnapshotRecord = {
  snapshotId: string;
  sourceQueryVersion: string;
  queryHash: string;
  fingerprint: string;
  recipientCount: number;
  exclusionCount: number;
  registrationCount: number;
  createdAt: string;
  replayed: boolean;
};

function toRecord(
  row: {
    id: string;
    sourceQueryVersion: string;
    queryHash: string;
    fingerprint: string;
    recipientCount: number;
    exclusionCount: number;
    registrationCount: number;
    createdAt: Date;
  },
  replayed: boolean,
): AudienceSnapshotRecord {
  return {
    snapshotId: row.id,
    sourceQueryVersion: row.sourceQueryVersion,
    queryHash: row.queryHash,
    fingerprint: row.fingerprint,
    recipientCount: row.recipientCount,
    exclusionCount: row.exclusionCount,
    registrationCount: row.registrationCount,
    createdAt: row.createdAt.toISOString(),
    replayed,
  };
}

/**
 * Records the reviewed audience for later scheduling (#177). Requires the fingerprint the staff member previewed: if the
 * audience moved since, nothing is recorded (PREVIEW_CHANGED). The same UUID with the same fingerprint returns the
 * original row; the same UUID with another fingerprint, event or query is IDEMPOTENCY_KEY_REUSED. It queues, sends and
 * schedules nothing.
 */
export async function createAudienceSnapshot(
  eventId: string,
  actorUserId: string,
  permissions: readonly string[],
  rawInput: unknown,
  options: AudienceEvaluationOptions = {},
): Promise<AudienceSnapshotRecord> {
  const input = audienceSnapshotInputSchema.parse(rawInput);
  const prisma = getPrisma();
  const { query, queryHash, result } = await evaluateEventAudience(eventId, permissions, input.query, options);

  const reuseError = () => new MessagingError(
    "IDEMPOTENCY_KEY_REUSED",
    "That snapshot id was already used for a different audience.",
  );
  const sameRequest = (row: { eventId: string; fingerprint: string; queryHash: string }) => (
    row.eventId === eventId && row.fingerprint === input.previewFingerprint && row.queryHash === queryHash
  );

  const existing = await prisma.eventAudienceSnapshot.findUnique({ where: { id: input.snapshotId } });
  if (existing) {
    if (!sameRequest(existing)) throw reuseError();
    return toRecord(existing, true);
  }
  if (result.fingerprint !== input.previewFingerprint) {
    throw new MessagingError(
      "PREVIEW_CHANGED",
      "The audience changed since you previewed it. Review the new preview before saving.",
      { currentFingerprint: result.fingerprint },
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.eventAudienceSnapshot.create({
        data: {
          id: input.snapshotId,
          eventId,
          createdByUserId: actorUserId,
          sourceQueryVersion: result.sourceQueryVersion,
          queryHash,
          query: query as unknown as Prisma.InputJsonValue,
          fingerprint: result.fingerprint,
          recipientCount: result.counts.recipientCount,
          exclusionCount: result.counts.exclusionCount,
          registrationCount: result.counts.recipientRegistrationCount,
        },
      });
      // Identifiers and counts only: never an address, a name, a balance line or a note.
      await tx.auditLog.create({
        data: {
          eventId,
          actorUserId,
          action: "EVENT_AUDIENCE_SNAPSHOT_CREATED",
          entityType: "EventAudienceSnapshot",
          entityId: row.id,
          correlationId: randomUUID(),
          summary: "Saved a reviewed event audience snapshot. Nothing was sent or scheduled.",
          metadata: {
            sourceQueryVersion: result.sourceQueryVersion,
            queryHash,
            fingerprint: result.fingerprint,
            recipientCount: result.counts.recipientCount,
            exclusionCount: result.counts.exclusionCount,
            registrationCount: result.counts.recipientRegistrationCount,
          },
        },
      });
      return row;
    });
    return toRecord(created, false);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.eventAudienceSnapshot.findUnique({ where: { id: input.snapshotId } });
      if (raced && sameRequest(raced)) return toRecord(raced, true);
      throw reuseError();
    }
    throw error;
  }
}
