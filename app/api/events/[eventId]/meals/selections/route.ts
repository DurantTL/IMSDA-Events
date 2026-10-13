import { jsonOk, mealRoute } from "@/modules/meals/api";
import { createMealOrder } from "@/modules/meals/selection-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/** A late addition for a registration or a walk-up order. It charges or credits money, so MANAGE_FINANCE. */
export const POST = mealRoute("MANAGE_FINANCE", "Adding the meal order", async ({ request, eventId, userId }) => {
  const id = await createMealOrder(eventId, userId, await request.json());
  return jsonOk({ id, meals: await loadMealView(eventId) }, 201);
});
