import { z } from "zod";
import { STAFF_DRAFT_SOURCES } from "@/modules/staff-registration-drafts/domain";

/** Answers arrive as a flat object of short plain values; the server keeps only what the form allows (see `domain.ts`). */
const responsesSchema = z.record(z.string().max(100), z.unknown()).refine(
  (value) => Object.keys(value).length <= 300 && JSON.stringify(value).length <= 64_000,
  "Too many answers.",
);

export const createStaffDraftSchema = z.strictObject({
  formId: z.string().trim().min(1).max(100),
  source: z.enum(STAFF_DRAFT_SOURCES),
  responses: responsesSchema.optional(),
});

export const updateStaffDraftSchema = z.strictObject({
  source: z.enum(STAFF_DRAFT_SOURCES).optional(),
  responses: responsesSchema,
});

export type CreateStaffDraftInput = z.infer<typeof createStaffDraftSchema>;
export type UpdateStaffDraftInput = z.infer<typeof updateStaffDraftSchema>;
