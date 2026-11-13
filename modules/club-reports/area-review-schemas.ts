import { z } from "zod";
import { ITEM_NOTE_MAX_LENGTH, isReviewableItemKey } from "@/modules/club-reports/area-review-domain";

/** The body of the coordinator's route. Strict: nothing else can be sent. */
export const itemReviewSchema = z.object({
  organizationId: z.string().trim().min(1).max(64),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "That month isn't valid."),
  itemKey: z.string().refine(isReviewableItemKey, "That item can't be reviewed."),
  outcome: z.enum(["OK", "RETURNED"]),
  /** The record's `updatedAt` as the coordinator saw it; a decision on a record that changed since is refused. */
  version: z.string().min(1).max(40),
  note: z.string().max(ITEM_NOTE_MAX_LENGTH * 4).optional(),
}).strict();
