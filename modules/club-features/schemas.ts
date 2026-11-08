import { z } from "zod";
import { CLUB_OPTIONAL_FEATURE_KEYS } from "@/modules/club-features/domain";

/** The Club settings save: each listed feature on or off. Only keys on the typed list are accepted. */
export const clubFeaturesInputSchema = z.object({
  features: z.partialRecord(z.enum(CLUB_OPTIONAL_FEATURE_KEYS), z.boolean()),
}).strict();

export type ClubFeaturesInput = z.infer<typeof clubFeaturesInputSchema>;
