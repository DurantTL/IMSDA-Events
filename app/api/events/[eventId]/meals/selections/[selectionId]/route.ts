import { z } from "zod";
import { jsonOk, mealRoute } from "@/modules/meals/api";
import { cancelMealSelection, changeMealPlan, changeMealQuantity, substituteMealSelection } from "@/modules/meals/selection-repository";
import { loadMealView } from "@/modules/meals/view-repository";

const actionSchema = z.object({ action: z.enum(["quantity", "cancel", "plan", "substitute"]) }).passthrough();

/** Change, cancel, move to another plan, or substitute a staff or walk-up order. Every one appends charges or credits. */
export const POST = mealRoute<{ selectionId: string }>("MANAGE_FINANCE", "Changing the meal order", async ({ request, eventId, userId, params }) => {
  const { action, ...rest } = actionSchema.parse(await request.json());
  if (action === "quantity") await changeMealQuantity(eventId, params.selectionId, userId, rest);
  else if (action === "cancel") await cancelMealSelection(eventId, params.selectionId, userId, rest);
  else if (action === "plan") await changeMealPlan(eventId, params.selectionId, userId, rest);
  else await substituteMealSelection(eventId, params.selectionId, userId, rest);
  return jsonOk({ meals: await loadMealView(eventId) });
});
