import { jsonOk, mealRoute } from "@/modules/meals/api";
import { createMealService } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/** Adding a meal service is event setup (CONFIGURE_EVENT). */
export const POST = mealRoute("CONFIGURE_EVENT", "Adding the meal service", async ({ request, eventId, userId }) => {
  const id = await createMealService(eventId, userId, await request.json());
  return jsonOk({ id, meals: await loadMealView(eventId) }, 201);
});
