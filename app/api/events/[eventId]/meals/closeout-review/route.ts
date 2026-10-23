import { jsonOk, mealRoute } from "@/modules/meals/api";
import { closeoutReviewInputSchema } from "@/modules/meals/closeout";
import { recordCloseoutReview } from "@/modules/meals/closeout-repository";
import { MealError } from "@/modules/meals/errors";

/**
 * Acknowledge or reopen one meal closeout exception (#212). MANAGE_FINANCE, checked on the server from the URL's event.
 * It records a decision and a note only: it creates no charge, credit, refund or count and changes no price. The
 * same-origin check runs on this mutation; the body is small JSON.
 */
export const POST = mealRoute("MANAGE_FINANCE", "Saving a closeout review", async ({ request, eventId, userId }) => {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 8 * 1024) throw new MealError("INVALID", "That request is too large.");
  const review = closeoutReviewInputSchema.parse(await request.json());
  return jsonOk(await recordCloseoutReview({ eventId, userId, review }));
});
