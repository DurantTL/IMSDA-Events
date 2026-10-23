import { z } from "zod";

/** Where an information form lives: no event (system administrators) or one event (MANAGE_FORMS on it). */
export type InformationFormTarget = { scope: "GENERAL" } | { scope: "EVENT"; eventId: string };

/** The one key that makes a web address unique per scope: the event id, or "GENERAL". */
export function scopeKeyFor(target: InformationFormTarget) {
  return target.scope === "EVENT" ? target.eventId : "GENERAL";
}

export function scopeWhere(target: InformationFormTarget) {
  return target.scope === "EVENT" ? { scope: "EVENT" as const, eventId: target.eventId } : { scope: "GENERAL" as const, eventId: null };
}

const isoDateTime = z.string().datetime({ offset: true }).transform((value) => new Date(value));

export const createInformationFormSchema = z.object({
  name: z.string().trim().min(3).max(120),
  fillAccess: z.enum(["ANYONE_WITH_LINK", "SIGNED_IN"]).default("ANYONE_WITH_LINK"),
  /** Start from a stored form template (#1065). Its definition must pass the information-form check. */
  templateKey: z.string().trim().min(1).max(80).optional(),
  /** Start from a given definition instead of the blank starter. Ignored when `templateKey` is given. */
  definition: z.unknown().optional(),
}).strict();

export const saveInformationFormDraftSchema = z.object({
  definition: z.unknown(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export const informationFormSettingsSchema = z.object({
  fillAccess: z.enum(["ANYONE_WITH_LINK", "SIGNED_IN"]).optional(),
  opensAt: z.union([isoDateTime, z.null()]).optional(),
  closesAt: z.union([isoDateTime, z.null()]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Send at least one setting to change.");

export const informationFormStatusSchema = z.object({
  status: z.enum(["OPEN", "CLOSED"]),
}).strict();

export const responseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).max(100).optional(),
});

export const submitResponseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  answers: z.record(z.string(), z.unknown()),
});
