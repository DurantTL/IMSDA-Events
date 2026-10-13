import { z } from "zod";
import { jsonOk, mealRoute } from "@/modules/meals/api";
import { removeMealPrice, setMealPrice } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/** Setting a price changes what attendees pay: MANAGE_FINANCE, audited with the old and new amount. A person sets it, never a seed. */
export const PUT = mealRoute<{ planId: string }>("MANAGE_FINANCE", "Saving the meal price", async ({ request, eventId, userId, params }) => {
  await setMealPrice(eventId, params.planId, userId, await request.json());
  return jsonOk({ meals: await loadMealView(eventId) });
});

export const DELETE = mealRoute<{ planId: string }>("MANAGE_FINANCE", "Removing the meal price", async ({ request, eventId, userId }) => {
  const { priceId } = z.object({ priceId: z.string().min(1).max(64) }).strict().parse(await request.json());
  await removeMealPrice(eventId, priceId, userId);
  return jsonOk({ meals: await loadMealView(eventId) });
});
