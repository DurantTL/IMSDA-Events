import { jsonOk, mealRoute } from "@/modules/meals/api";
import { updateMealPlan } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

export const PUT = mealRoute<{ planId: string }>("MANAGE_FINANCE", "Saving the meal plan", async ({ request, eventId, userId, params }) => {
  await updateMealPlan(eventId, params.planId, userId, await request.json());
  return jsonOk({ meals: await loadMealView(eventId) });
});
