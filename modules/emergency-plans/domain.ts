import { z } from "zod";
import { MAX_PHONE_LENGTH, validatePhone } from "@/lib/field-validation";
import { eventContentItemSchema, parseEventContentItems, type EventContentItem } from "@/modules/events/content-schemas";

/**
 * Event emergency plan (#114): pure validation and the published snapshot.
 * Procedural, staff-entered operational data only. Nothing here reads or
 * names an attendee, guardian, medical, custody or incident record.
 */

export const emergencyLocationKinds = ["ASSEMBLY", "SHELTER"] as const;
export const emergencyProcedureKinds = ["EVACUATION", "SEVERE_WEATHER", "OTHER"] as const;
export type EmergencyLocationKind = (typeof emergencyLocationKinds)[number];
export type EmergencyProcedureKind = (typeof emergencyProcedureKinds)[number];

export const emergencyLocationKindLabels: Record<EmergencyLocationKind, string> = {
  ASSEMBLY: "Assembly location",
  SHELTER: "Shelter",
};
export const emergencyProcedureKindLabels: Record<EmergencyProcedureKind, string> = {
  EVACUATION: "Evacuation",
  SEVERE_WEATHER: "Severe weather",
  OTHER: "Other",
};

const text = (max: number) => z.string().trim().max(max).default("");
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/** A web address (http or https only) or a plain grid reference such as "Grid C4". */
const mapReferenceSchema = z.string().trim().max(500).nullish().transform((value) => (value ? value : null)).superRefine((value, context) => {
  if (value === null || !/^[a-z][a-z0-9+.-]*:/i.test(value)) return;
  if (!z.url().safeParse(value).success || !/^https?:\/\//i.test(value)) {
    context.addIssue({ code: "custom", message: "Use a web address that starts with http:// or https://, or a grid reference." });
  }
});

export const emergencyLocationInputSchema = z.object({
  kind: z.enum(emergencyLocationKinds),
  name: required(120, "Give each location a name."),
  description: text(600),
  capacityNote: text(200),
  directions: text(1000),
  mapReference: mapReferenceSchema,
}).strict();

export const emergencyProcedureInputSchema = z.object({
  kind: z.enum(emergencyProcedureKinds),
  title: required(120, "Give each procedure a title."),
  /** Plain text with blank-line paragraphs, the same body rule as event content (never HTML). */
  body: text(20000),
  items: z.array(eventContentItemSchema).max(40, "A procedure can have up to 40 steps.").default([]),
}).strict();

export const emergencyPhoneSchema = z.string().trim().min(1, "Give each contact a phone number.").max(MAX_PHONE_LENGTH).transform((value, context) => {
  const check = validatePhone(value);
  if (!check.ok) {
    context.addIssue({ code: "custom", message: "Enter a valid phone number, like (515) 555-0100." });
    return z.NEVER;
  }
  return check.value;
});

export const emergencyContactInputSchema = z.object({
  role: required(100, "Give each contact a role."),
  name: required(120, "Give each contact a name."),
  phone: emergencyPhoneSchema,
  escalationOrder: z.number().int("Escalation order is a whole number.").min(1, "Escalation order starts at 1.").max(99),
}).strict();

export const emergencyPlanDraftSchema = z.object({
  locations: z.array(emergencyLocationInputSchema).max(40, "Up to 40 locations."),
  procedures: z.array(emergencyProcedureInputSchema).max(30, "Up to 30 procedures."),
  contacts: z.array(emergencyContactInputSchema).max(30, "Up to 30 contacts."),
}).strict().superRefine((draft, context) => {
  const seen = new Set<number>();
  for (const [index, contact] of draft.contacts.entries()) {
    if (seen.has(contact.escalationOrder)) {
      context.addIssue({
        code: "custom",
        path: ["contacts", index, "escalationOrder"],
        message: "Each contact needs its own escalation order. Two contacts share the same number.",
      });
    }
    seen.add(contact.escalationOrder);
  }
});

export type EmergencyPlanDraft = z.infer<typeof emergencyPlanDraftSchema>;
export type EmergencyPlanDraftInput = z.input<typeof emergencyPlanDraftSchema>;

export const emptyEmergencyPlanDraft: EmergencyPlanDraft = { locations: [], procedures: [], contacts: [] };

export function isEmptyEmergencyPlan(draft: EmergencyPlanDraft): boolean {
  return draft.locations.length === 0 && draft.procedures.length === 0 && draft.contacts.length === 0;
}

// --- The published snapshot -------------------------------------------------

/**
 * The explicit allowlist of keys a snapshot (and so a printed sheet or export)
 * may carry. A new field must be added here on purpose; the builder copies
 * these keys and nothing else.
 */
export const snapshotAllowedKeys = {
  root: ["schemaVersion", "event", "locations", "procedures", "contacts"],
  event: ["name", "startsOn", "endsOn", "timezone"],
  location: ["kind", "name", "description", "capacityNote", "directions", "mapReference"],
  procedure: ["kind", "title", "body", "items"],
  item: ["title", "text"],
  contact: ["escalationOrder", "role", "name", "phone"],
} as const;

export const emergencyPlanSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  event: z.object({
    name: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
    timezone: z.string(),
  }).strict(),
  locations: z.array(z.object({
    kind: z.enum(emergencyLocationKinds),
    name: z.string(),
    description: z.string(),
    capacityNote: z.string(),
    directions: z.string(),
    mapReference: z.string().nullable(),
  }).strict()),
  procedures: z.array(z.object({
    kind: z.enum(emergencyProcedureKinds),
    title: z.string(),
    body: z.string(),
    items: z.array(eventContentItemSchema),
  }).strict()),
  contacts: z.array(z.object({
    escalationOrder: z.number().int(),
    role: z.string(),
    name: z.string(),
    phone: z.string(),
  }).strict()),
}).strict();

export type EmergencyPlanSnapshot = z.infer<typeof emergencyPlanSnapshotSchema>;

export type SnapshotEvent = { name: string; startsAt: Date; endsAt: Date; timezone: string };

/** A calendar date, "2026-07-14", in the event's own timezone. */
export function isoDateInZone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Builds the snapshot from the draft and the event's name and dates. Pure and
 * an allowlist: every field is copied by name, so a stray property on the
 * input can never reach a published version. Contacts are in escalation order.
 */
export function buildEmergencyPlanSnapshot(draft: EmergencyPlanDraft, event: SnapshotEvent): EmergencyPlanSnapshot {
  return {
    schemaVersion: 1,
    event: {
      name: event.name,
      startsOn: isoDateInZone(event.startsAt, event.timezone),
      endsOn: isoDateInZone(event.endsAt, event.timezone),
      timezone: event.timezone,
    },
    locations: draft.locations.map((location) => ({
      kind: location.kind,
      name: location.name,
      description: location.description,
      capacityNote: location.capacityNote,
      directions: location.directions,
      mapReference: location.mapReference,
    })),
    procedures: draft.procedures.map((procedure) => ({
      kind: procedure.kind,
      title: procedure.title,
      body: procedure.body,
      items: procedure.items.map((item): EventContentItem => ({ title: item.title, text: item.text })),
    })),
    contacts: [...draft.contacts]
      .sort((a, b) => a.escalationOrder - b.escalationOrder)
      .map((contact) => ({
        escalationOrder: contact.escalationOrder,
        role: contact.role,
        name: contact.name,
        phone: contact.phone,
      })),
  };
}

/** Reads a stored snapshot back; null when it is not the expected shape, so nothing unexpected is ever shown. */
export function parseEmergencyPlanSnapshot(value: unknown): EmergencyPlanSnapshot | null {
  const parsed = emergencyPlanSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Stored procedure steps back into items, leniently (a malformed row shows no steps). */
export function storedProcedureItems(value: unknown): EventContentItem[] {
  return parseEventContentItems(value);
}

/** "Fri, Oct 30, 2026, 2:05 PM CDT" in the event's timezone, for the printed footer. */
export function formatPrintTimestamp(date: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}
