import { z } from "zod";

/** One helper-list line (#654): the quantity wanted (0 takes it off the list), or null to put it back to the computed count. */
export const clubOrderListQuantitySchema = z.object({
  quantity: z.number().int().min(0).max(10_000).nullable(),
}).strict();

/** Marking a group of needs awarded (#487): up to 500 at once, like the roster's own bulk actions. */
export const clubOrderAwardInputSchema = z.object({
  needIds: z.array(z.string().min(1)).min(1).max(500),
}).strict();

export type ClubOrderAwardInput = z.infer<typeof clubOrderAwardInputSchema>;

/** A club's conference order (#1688): quantities by catalog item id, and the patches to exchange. Counts are checked and capped on the server. */
export const conferenceOrderSubmitSchema = z.object({
  quantities: z.record(z.string().min(1).max(64), z.union([z.number(), z.string().max(8)])).refine((value) => Object.keys(value).length <= 50, "Too many items."),
  patchesToExchange: z.union([z.number(), z.string().max(8)]).optional(),
}).strict();

/** Staff fill an order (#1688): the postage as typed (dollars and cents, blank for none) and whether the items join the club's stock. */
export const conferenceOrderFillSchema = z.object({
  postage: z.union([z.string().max(20), z.number()]).optional(),
  addToStock: z.boolean().default(false),
}).strict();

/** Staff cancel a submitted order with a reason (#1688). */
export const conferenceOrderCancelSchema = z.object({
  reason: z.string().max(1000),
}).strict();
