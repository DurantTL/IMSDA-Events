import { z } from "zod";

const id = z.string().trim().min(1).max(64);

/** A church's pastor contact (#977). Name is required; email and phone are optional but validated when given. */
export const pastorContactInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the pastor's name.").max(120),
  email: z
    .union([z.literal(""), z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address, or leave it blank."))])
    .optional()
    .transform((value) => value || null),
  phone: z.string().trim().max(40).optional().transform((value) => value || null),
});

export type PastorContactInput = z.infer<typeof pastorContactInputSchema>;

export const organizationContactActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), contact: pastorContactInputSchema }),
  z.object({ action: z.literal("end"), contactId: id, reason: z.string().trim().max(500).optional() }),
]);
