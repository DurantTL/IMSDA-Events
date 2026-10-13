import { jsonOk, mealRoute } from "@/modules/meals/api";
import { entitleAttendeeToPlan } from "@/modules/meals/selection-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/** Entitle an attendee to a conference-paid plan (the staff, pastor and volunteer meals, #804). Never charges the attendee. */
export const POST = mealRoute("MANAGE_FINANCE", "Entitling the attendee to meals", async ({ request, eventId, userId }) => {
  const created = await entitleAttendeeToPlan(eventId, userId, await request.json());
  return jsonOk({ added: created.length, meals: await loadMealView(eventId) }, 201);
});
