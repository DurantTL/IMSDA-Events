import { jsonOk, mealRoute } from "@/modules/meals/api";
import { MealError } from "@/modules/meals/errors";
import { kitchenCountInputSchema } from "@/modules/meals/kitchen-counts";
import { recordKitchenCount } from "@/modules/meals/kitchen-counts-repository";

/**
 * Enter or correct one kitchen count (#1029). MANAGE_KITCHEN_COUNTS, checked on the server from the URL's event: the
 * Kitchen staff role has it and no registration or people permission, so it opens nothing else. The same-origin check runs
 * on this mutation. The body is small JSON; a correction must name the entry it replaces.
 */
export const POST = mealRoute("MANAGE_KITCHEN_COUNTS", "Saving a kitchen count", async ({ request, eventId, userId }) => {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 8 * 1024) throw new MealError("INVALID", "That request is too large.");
  const entry = kitchenCountInputSchema.parse(await request.json());
  const result = await recordKitchenCount({ eventId, userId, entry });
  return jsonOk(result);
});
