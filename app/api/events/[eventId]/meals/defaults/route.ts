import { z } from "zod";
import { jsonOk, mealRoute } from "@/modules/meals/api";
import { applyCampMeetingMealPreset } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/**
 * Adds the Camp Meeting 2026 meal services and plans to an event that has none. A person chooses this (it sets prices,
 * so MANAGE_FINANCE); nothing applies it by itself.
 */
export const POST = mealRoute("MANAGE_FINANCE", "Adding the Camp Meeting meals", async ({ request, eventId, userId }) => {
  z.object({ preset: z.literal("camp-meeting-2026") }).strict().parse(await request.json());
  const created = await applyCampMeetingMealPreset(eventId, userId);
  return jsonOk({ created, meals: await loadMealView(eventId) }, 201);
});
