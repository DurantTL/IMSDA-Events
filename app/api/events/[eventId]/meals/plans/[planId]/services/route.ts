import { jsonOk, mealRoute } from "@/modules/meals/api";
import { setMealPlanServices } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/** Which services a plan lists, and whether each is paid or included. */
export const PUT = mealRoute<{ planId: string }>("MANAGE_FINANCE", "Saving the plan's meals", async ({ request, eventId, userId, params }) => {
  await setMealPlanServices(eventId, params.planId, userId, await request.json());
  return jsonOk({ meals: await loadMealView(eventId) });
});
