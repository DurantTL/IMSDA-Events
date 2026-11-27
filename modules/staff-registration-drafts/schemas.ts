import { z } from "zod";
import { publicRegistrationInputSchema, type PublicRegistrationInput } from "@/modules/forms/public-domain";
import { STAFF_DRAFT_MAX_ATTENDEES, STAFF_DRAFT_SOURCES } from "@/modules/staff-registration-drafts/domain";

/** Answers arrive as a flat object of short plain values; the server keeps only what the form allows (see `domain.ts`). */
const responsesSchema = z.record(z.string().max(100), z.unknown()).refine(
  (value) => Object.keys(value).length <= 300 && JSON.stringify(value).length <= 64_000,
  "Too many answers.",
);

/** The people attending (#1510): a short list of `{ clientId, responses }`; the server keeps only what a draft may hold. */
const attendeesSchema = z.array(z.strictObject({
  clientId: z.string().trim().min(1).max(80),
  responses: responsesSchema,
})).max(STAFF_DRAFT_MAX_ATTENDEES);

export const createStaffDraftSchema = z.strictObject({
  formId: z.string().trim().min(1).max(100),
  source: z.enum(STAFF_DRAFT_SOURCES),
  responses: responsesSchema.optional(),
  attendees: attendeesSchema.optional(),
});

export const updateStaffDraftSchema = z.strictObject({
  source: z.enum(STAFF_DRAFT_SOURCES).optional(),
  responses: responsesSchema,
  /** Left out, the people already on the draft are kept as they are. */
  attendees: attendeesSchema.optional(),
});

export type CreateStaffDraftInput = z.infer<typeof createStaffDraftSchema>;
export type UpdateStaffDraftInput = z.infer<typeof updateStaffDraftSchema>;

/** The reason for going past a rule: trimmed, 10 to 500 characters. */
export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;

const staffSubmitExtrasSchema = z.strictObject({
  paperLocation: z.string().trim().max(200).optional(),
  override: z.strictObject({ reason: z.string().trim().min(OVERRIDE_REASON_MIN).max(OVERRIDE_REASON_MAX) }).optional(),
});

export type StaffSubmitBody = {
  input: PublicRegistrationInput;
  paperLocation: string | null;
  override: { reason: string } | null;
};

/**
 * Staff sending a draft for the registrant (#1510): the public registration input exactly (versionId, idempotencyKey,
 * answers, people, responsible adults, lodging, merchandise), without the registrant's link token, plus an optional paper
 * location and an optional override with a reason. Strict: anything else is refused. The source is never in the body.
 */
export function parseStaffSubmitBody(raw: unknown): StaffSubmitBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new z.ZodError([{ code: "custom", path: [], message: "Send the registration as a JSON object." }]);
  const { paperLocation, override, ...rest } = raw as Record<string, unknown>;
  if ("staffDraftToken" in rest) throw new z.ZodError([{ code: "custom", path: ["staffDraftToken"], message: "A staff submit has no registrant link." }]);
  const extras = staffSubmitExtrasSchema.parse({
    ...(paperLocation === undefined ? {} : { paperLocation }),
    ...(override === undefined ? {} : { override }),
  });
  const input = publicRegistrationInputSchema.parse(rest);
  return { input, paperLocation: extras.paperLocation ?? null, override: extras.override ?? null };
}
