import { jsonOk, mealRoute } from "@/modules/meals/api";
import { loadMealView } from "@/modules/meals/view-repository";

/** The Meals screen's data: services, plans with their prices, totals and recent staff orders. */
export const GET = mealRoute("VIEW_REPORTS", "Loading meals", async ({ eventId }) => jsonOk({ meals: await loadMealView(eventId) }), { mutates: false });
