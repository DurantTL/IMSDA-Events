import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/modules/event-modules/service";
import { formatPersonName } from "@/lib/person-name";
import { normalizedTagName } from "@/modules/tags/domain";
import { applyAttendeeTag, removeAttendeeTag, TagConfigurationError } from "@/modules/tags/repository";
import {
  RECOGNITION_MODULE_KEY,
  clubLabel,
  recognitionColors,
  recognitionInputSchema,
  summarizeRecognitions,
  type RecognitionDefinition,
  type RecognitionItemValue,
  type RecognitionMark,
  type RecognitionSearchResult,
} from "@/modules/recognitions/domain";

export class RecognitionError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "NOT_CLUB_EVENT" | "MODULE_OFF" | "NAME_CONFLICT", message: string) {
    super(message);
    this.name = "RecognitionError";
  }
}

const registeredStatuses = ["SUBMITTED", "CONFIRMED"] as const;

/** The module switch is a relevance switch, not authorization; this only keeps a switched-off tool from being used by accident. */
export async function requireRecognitionsOn(eventId: string) {
  const event = await getPrisma().event.findUnique({ where: { id: eventId }, select: { audience: true } });
  if (!event) throw new RecognitionError("NOT_FOUND", "That event was not found.");
  if (event.audience !== "CLUB") throw new RecognitionError("NOT_CLUB_EVENT", "Recognitions are for club events.");
  if (!(await isModuleEnabled(eventId, RECOGNITION_MODULE_KEY))) throw new RecognitionError("MODULE_OFF", "Recognitions are off for this event.");
}

export async function listRecognitions(eventId: string): Promise<RecognitionDefinition[]> {
  const rows = await getPrisma().eventTag.findMany({
    where: { eventId, recognitionItem: { not: null } },
    orderBy: [{ recognitionItem: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, recognitionItem: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive, item: row.recognitionItem as RecognitionItemValue }));
}

export async function createRecognition(eventId: string, actorUserId: string, rawInput: unknown): Promise<RecognitionDefinition> {
  const input = recognitionInputSchema.parse(rawInput);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const created = await tx.eventTag.create({
        data: { eventId, name: input.name, normalizedName: normalizedTagName(input.name), color: recognitionColors[input.item], recognitionItem: input.item },
      });
      await tx.auditLog.create({
        data: { eventId, actorUserId, action: "TAG_CREATED", entityType: "EventTag", entityId: created.id, correlationId: randomUUID(), summary: `Created recognition ${created.name}.`, metadata: { recognitionItem: input.item } },
      });
      return { id: created.id, name: created.name, isActive: created.isActive, item: input.item };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new RecognitionError("NAME_CONFLICT", "A recognition or tag with that name already exists for this event.");
    }
    throw error;
  }
}

async function recognitionTag(eventId: string, recognitionId: string) {
  const tag = await getPrisma().eventTag.findFirst({ where: { id: recognitionId, eventId, recognitionItem: { not: null } }, select: { id: true } });
  if (!tag) throw new RecognitionError("NOT_FOUND", "That recognition was not found for this event.");
}

/** Marks through the audited attendee tag path, so who marked it and when is kept. Marking twice changes nothing. */
export async function markRecognition(eventId: string, attendeeId: string, recognitionId: string, actorUserId: string) {
  await recognitionTag(eventId, recognitionId);
  await assertClubAttendee(eventId, attendeeId);
  await applyAttendeeTag(eventId, attendeeId, recognitionId, actorUserId);
}

/** Undo removes the mark through the same path: the row stays with its remover and time, so history is kept. */
export async function undoRecognition(eventId: string, attendeeId: string, recognitionId: string, actorUserId: string) {
  await recognitionTag(eventId, recognitionId);
  await removeAttendeeTag(eventId, attendeeId, recognitionId, actorUserId);
}

async function assertClubAttendee(eventId: string, attendeeId: string) {
  const found = await getPrisma().registrationAttendee.findFirst({
    where: { id: attendeeId, eventId, registration: { status: { in: [...registeredStatuses] }, clubRegistration: { isNot: null } } },
    select: { id: true },
  });
  if (!found) throw new TagConfigurationError("NOT_FOUND", "That attendee was not found for this event.");
}

type NameParts = { profileSnapshot: unknown; person: { firstName: string; lastName: string } };
function attendeeName(attendee: NameParts) {
  const snapshot = (attendee.profileSnapshot ?? {}) as { firstName?: unknown; lastName?: unknown };
  const first = typeof snapshot.firstName === "string" && snapshot.firstName.trim() ? snapshot.firstName : attendee.person.firstName;
  const last = typeof snapshot.lastName === "string" && snapshot.lastName.trim() ? snapshot.lastName : attendee.person.lastName;
  return formatPersonName({ firstName: first, lastName: last });
}

const attendeeSelect = {
  id: true,
  profileSnapshot: true,
  person: { select: { firstName: true, lastName: true } },
  registration: { select: { clubRegistration: { select: { organizationId: true, teamKey: true, teamName: true, organization: { select: { name: true } } } } } },
} as const;

type AttendeeRow = Prisma.RegistrationAttendeeGetPayload<{ select: typeof attendeeSelect }>;

function clubOf(row: AttendeeRow) {
  const club = row.registration.clubRegistration;
  return {
    clubKey: club ? `${club.organizationId}|${club.teamKey}` : "none",
    clubName: club ? clubLabel(club.organization.name, club.teamName) : "No club",
  };
}

/** Attendees of this event's registered clubs whose name contains every word typed. Names and club only, at most 20. */
export async function searchRecognitionAttendees(eventId: string, query: string): Promise<RecognitionSearchResult[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return [];
  const rows = await getPrisma().registrationAttendee.findMany({
    where: {
      eventId,
      registration: { status: { in: [...registeredStatuses] }, clubRegistration: { isNot: null } },
      AND: words.map((word) => ({
        OR: [
          { person: { firstName: { contains: word, mode: "insensitive" as const } } },
          { person: { lastName: { contains: word, mode: "insensitive" as const } } },
        ],
      })),
    },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { id: "asc" }],
    take: 20,
    select: attendeeSelect,
  });
  const marks = await getPrisma().attendeeTagAssignment.findMany({
    where: { eventId, attendeeId: { in: rows.map((row) => row.id) }, removedAt: null, tag: { recognitionItem: { not: null } } },
    select: { attendeeId: true, tagId: true },
  });
  return rows.map((row) => ({
    attendeeId: row.id,
    name: attendeeName(row),
    clubName: clubOf(row).clubName,
    earnedRecognitionIds: marks.filter((mark) => mark.attendeeId === row.id).map((mark) => mark.tagId),
  }));
}

export async function loadRecognitionSummary(eventId: string) {
  const definitions = await listRecognitions(eventId);
  const assignments = await getPrisma().attendeeTagAssignment.findMany({
    where: { eventId, removedAt: null, tag: { recognitionItem: { not: null }, isActive: true } },
    select: { tagId: true, attendee: { select: attendeeSelect } },
  });
  const marks: RecognitionMark[] = assignments.map((row) => ({
    recognitionId: row.tagId,
    attendeeId: row.attendee.id,
    attendeeName: attendeeName(row.attendee),
    ...clubOf(row.attendee),
  }));
  // A recognition staff switched off no longer counts toward what to order, but its marks and history stay.
  return { definitions, summary: summarizeRecognitions(definitions.filter((definition) => definition.isActive), marks) };
}
