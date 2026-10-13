import { jsonOk, mealRoute } from "@/modules/meals/api";
import { createMealPlan } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/** A plan decides who pays and what a meal costs, so it takes the finance permission. */
export const POST = mealRoute("MANAGE_FINANCE", "Adding the meal plan", async ({ request, eventId, userId }) => {
  const id = await createMealPlan(eventId, userId, await request.json());
  return jsonOk({ id, meals: await loadMealView(eventId) }, 201);
});
