import { z } from "zod";
import { MAX_PHONE_LENGTH, normalizePhoneAnswer, validateEmail } from "@/lib/field-validation";

const id = z.string().trim().min(1).max(64);

/** A church's pastor contact (#977). Name is required; email and phone are optional but validated when given. */
export const pastorContactInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the pastor's name.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((value) => value === "" || validateEmail(value).ok, "Enter a valid email address, or leave it blank.")
    .optional()
    .transform((value) => value || null),
  // A phone that passes is stored as "(515) 555-0134". One that does not is left as typed for `setPastorContact` to judge
  // against the stored contact (#1193), so an old saved phone is not held against a retry.
  phone: z.string().trim().max(MAX_PHONE_LENGTH).optional().transform((value) => (value ? normalizePhoneAnswer(value) : null)),
});

export type PastorContactInput = z.infer<typeof pastorContactInputSchema>;

export const organizationContactActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), contact: pastorContactInputSchema }),
  z.object({ action: z.literal("end"), contactId: id, reason: z.string().trim().max(500).optional() }),
]);
