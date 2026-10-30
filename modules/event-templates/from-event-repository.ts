import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { appOrigins, fingerprintOf, loadSourceConfiguration } from "@/modules/event-clones/repository";
import { canonicalJson } from "@/modules/event-clones/domain";
import { eventTemplatePayloadSchema, type EventTemplatePayload } from "@/modules/event-templates/domain";
import {
  buildTemplateFromEvent,
  previewTemplateFromEventInputSchema,
  saveTemplateFromEventInputSchema,
  saveTemplateRequestInputOf,
  type SaveTemplateFromEventInput,
  type TemplateFromEventPreview,
  type TemplateSourceConfiguration,
} from "@/modules/event-templates/from-event-domain";
import {
  EventTemplateOperationError,
  getEventTemplate,
  lockTemplate,
  refuseArchived,
} from "@/modules/event-templates/repository";

type Db = Prisma.TransactionClient;

/** The template's own settings an event cannot supply, read from its current version (published, else the latest). */
function settingsToKeep(payload: EventTemplatePayload) {
  return {
    reportSelections: payload.reportSelections,
    formTemplateKeys: payload.formTemplateKeys,
    registrationClosesOn: payload.registrationClosesOn,
    starterKey: payload.starterKey,
  };
}

/** Bounded wait for the source row lock; past it the save reports a busy template, never a hang. */
const sourceLockTimeout = "5s";

/**
 * Reads the source event's configuration the way the annual clone does (configuration tables only, explicit selects),
 * plus the one switch a clone does not need. Registrations, attendees, payments and every other transactional table are
 * never read, so none of it can reach the preview, the fingerprint or the template.
 */
async function loadTemplateSource(db: Db | ReturnType<typeof getPrisma>, eventId: string): Promise<TemplateSourceConfiguration | null> {
  const config = await loadSourceConfiguration(db as Db, eventId);
  if (!config) return null;
  const flags = await db.event.findUnique({ where: { id: eventId }, select: { generalRegistrationLinkEnabled: true } });
  return { config, generalRegistrationLink: flags?.generalRegistrationLinkEnabled ?? false };
}

/** Hash of what a save would copy, so a save after the event changed is refused. */
function templateFingerprintOf(source: TemplateSourceConfiguration) {
  // The event's dates are in it because the saved day offsets depend on the start date.
  const dates = `${source.config.event.startsOn}:${source.config.event.endsOn}`;
  return createHash("sha256").update(`${fingerprintOf(source.config)}:${dates}:${source.generalRegistrationLink ? "link" : "nolink"}`).digest("hex");
}

export type TemplateFromEventPreviewResult = TemplateFromEventPreview & { fingerprint: string };

/** The preview for saving `sourceEventId` as a template (#154): exactly what would be copied, and everything that would not. */
export async function previewTemplateFromEvent(rawInput: unknown): Promise<TemplateFromEventPreviewResult> {
  const { sourceEventId } = previewTemplateFromEventInputSchema.parse(rawInput);
  const source = await loadTemplateSource(getPrisma(), sourceEventId);
  if (!source) throw new EventTemplateOperationError("SOURCE_NOT_FOUND", "That source event was not found.");
  const { preview } = buildTemplateFromEvent(source, appOrigins());
  return { ...preview, fingerprint: templateFingerprintOf(source) };
}

/**
 * Resolves a stored save for this actor's `requestKey`: the same request returns the version the first attempt made;
 * anything else is a reused key and is refused. Compared before the source is read, so a retry after success never
 * reports a changed source.
 */
async function resolveExistingSave(actorUserId: string, input: SaveTemplateFromEventInput) {
  const existing = await getPrisma().eventTemplateVersionSource.findUnique({
    where: { actorUserId_requestKey: { actorUserId, requestKey: input.requestKey } },
    include: { templateVersion: { select: { id: true, templateId: true, versionNumber: true } } },
  });
  if (!existing) return null;
  if (canonicalJson(existing.requestInput) !== canonicalJson(saveTemplateRequestInputOf(input))) {
    throw new EventTemplateOperationError("REQUEST_KEY_REUSED", "This request was already used to save a different template version. Reload the page and try again.");
  }
  return {
    template: await getEventTemplate(existing.templateVersion.templateId),
    versionId: existing.templateVersion.id,
    versionNumber: existing.templateVersion.versionNumber,
    alreadySaved: true,
    kept: [] as Array<{ key: string; label: string; count: number }>,
  };
}

/**
 * Saves a reviewed event configuration as a new template, or as the next DRAFT version of an existing one (#154).
 *
 * - Idempotent per actor by `requestKey`; a finished request is detected up front and again on a unique-constraint race.
 * - Everything is one transaction: the template row is locked (`FOR UPDATE`) for a new version, the source event row is
 *   share-locked, and the configuration is read again inside the transaction and must hash to the fingerprint the
 *   reviewer previewed, so what is saved is exactly what was shown.
 * - The version is always a DRAFT; publishing goes through the existing publish route, which validates references.
 *   Published versions are never touched, so events already created from them and their applications stay as they are.
 * - An archived template is refused, and so is a template that already has a draft (it is never overwritten) or whose
 *   audience differs from the event's.
 * - Provenance (`EventTemplateVersionSource`) records the source event, the form and message versions copied, the
 *   fingerprint, the exclusions, the actor and the release note. The audit entry carries ids and counts only.
 */
export async function saveTemplateFromEvent(actorUserId: string, rawInput: unknown) {
  const input = saveTemplateFromEventInputSchema.parse(rawInput);
  const prisma = getPrisma();

  const alreadySaved = await resolveExistingSave(actorUserId, input);
  if (alreadySaved) return alreadySaved;

  try {
    const saved = await prisma.$transaction(async (tx) => {
      let templateId: string | null = null;
      let versionNumber = 1;
      let existingAudience: "GENERAL" | "CLUB" | null = null;
      let existingSettings: ReturnType<typeof settingsToKeep> | null = null;
      if (input.target.mode === "NEW_VERSION") {
        templateId = input.target.templateId;
        refuseArchived(await lockTemplate(tx, templateId, "UPDATE"), "saved to");
        const versions = await tx.eventTemplateVersion.findMany({ where: { templateId }, orderBy: { versionNumber: "desc" } });
        if (versions.some((version) => version.status === "DRAFT")) {
          throw new EventTemplateOperationError("DRAFT_EXISTS", "This template already has a draft. Publish it or edit it in the template editor first, or save as a new template.");
        }
        versionNumber = (versions[0]?.versionNumber ?? 0) + 1;
        const current = versions.find((version) => version.status === "PUBLISHED") ?? versions[0];
        const parsed = current ? eventTemplatePayloadSchema.safeParse(current.payload) : null;
        existingAudience = parsed?.success ? parsed.data.audience : null;
        existingSettings = parsed?.success ? settingsToKeep(parsed.data) : null;
      }

      // Share-lock the source row so its own settings cannot change mid-save; child configuration is guarded by the fingerprint.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${sourceLockTimeout}'`);
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${input.sourceEventId} FOR SHARE`;
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = 0");
      if (locked.length === 0) throw new EventTemplateOperationError("SOURCE_NOT_FOUND", "That source event was not found.");
      const source = await loadTemplateSource(tx, input.sourceEventId);
      if (!source) throw new EventTemplateOperationError("SOURCE_NOT_FOUND", "That source event was not found.");
      const fingerprint = templateFingerprintOf(source);
      if (fingerprint !== input.fingerprint) {
        throw new EventTemplateOperationError("SOURCE_CHANGED", "The event changed after you previewed it. Preview it again and review what will be copied.");
      }
      const build = buildTemplateFromEvent(source, appOrigins(), existingSettings);
      if (existingAudience !== null && existingAudience !== build.payload.audience) {
        throw new EventTemplateOperationError("AUDIENCE_MISMATCH", "This event's audience differs from the template's. Save it as a new template instead.");
      }
      const payload = build.payload as unknown as Prisma.InputJsonValue;

      let templateName: string;
      let version: { id: string };
      if (input.target.mode === "NEW") {
        const template = await tx.eventTemplate.create({
          data: {
            name: input.target.name,
            description: input.target.description,
            createdByUserId: actorUserId,
            versions: { create: { createdByUserId: actorUserId, versionNumber: 1, status: "DRAFT", payload } },
          },
          include: { versions: { select: { id: true } } },
        });
        templateId = template.id;
        templateName = template.name;
        version = template.versions[0]!;
      } else {
        const template = await tx.eventTemplate.update({ where: { id: templateId! }, data: { updatedAt: new Date() }, select: { name: true } });
        templateName = template.name;
        version = await tx.eventTemplateVersion.create({
          data: { templateId: templateId!, createdByUserId: actorUserId, versionNumber, status: "DRAFT", payload },
          select: { id: true },
        });
      }

      await tx.eventTemplateVersionSource.create({
        data: {
          templateVersionId: version.id,
          sourceEventId: source.config.event.id,
          sourceEventName: source.config.event.name,
          actorUserId,
          releaseNote: input.releaseNote,
          requestKey: input.requestKey,
          requestInput: saveTemplateRequestInputOf(input) as unknown as Prisma.InputJsonValue,
          provenance: { ...build.provenance, fingerprint } as unknown as Prisma.InputJsonValue,
          // Keys, counts and reduced link origins only: never copied text.
          exclusions: build.storedExclusions as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({ data: {
        actorUserId, action: "EVENT_TEMPLATE_SAVED_FROM_EVENT", entityType: "EventTemplate", entityId: templateId!,
        correlationId: randomUUID(), summary: `Saved ${templateName} version ${versionNumber} from an event.`,
        // Ids and counts only: never the copied wording.
        metadata: {
          templateId: templateId!,
          templateVersionId: version.id,
          versionNumber,
          mode: input.target.mode,
          sourceEventId: source.config.event.id,
          fingerprint,
          counts: Object.fromEntries(build.preview.domains.map((domain) => [domain.key, domain.count])),
          exclusionCounts: Object.fromEntries(build.preview.exclusions.filter((entry) => entry.count !== null).map((entry) => [entry.key, entry.count])),
        },
      } });

      return { templateId: templateId!, versionId: version.id, versionNumber, kept: build.kept };
    });
    return { template: await getEventTemplate(saved.templateId), versionId: saved.versionId, versionNumber: saved.versionNumber, alreadySaved: false, kept: saved.kept };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A concurrent request with this actor's key may have committed first.
      const raced = await resolveExistingSave(actorUserId, input);
      if (raced) return raced;
    }
    throw error;
  }
}
