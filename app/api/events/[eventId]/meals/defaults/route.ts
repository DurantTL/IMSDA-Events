import { z } from "zod";
import { jsonOk, mealRoute } from "@/modules/meals/api";
import { applyMealPreset } from "@/modules/meals/config-repository";
import { loadMealView } from "@/modules/meals/view-repository";

/**
 * Adds a seeded meal preset's services and plans (for example `camp-meeting-2026`, #919) to an event that has none. A
 * person chooses this (it sets prices, so MANAGE_FINANCE); nothing applies it by itself. An unknown preset is a 400.
 */
export const POST = mealRoute("MANAGE_FINANCE", "Adding the meal preset", async ({ request, eventId, userId }) => {
  const { preset } = z.object({ preset: z.string().trim().min(1).max(80) }).strict().parse(await request.json());
  const created = await applyMealPreset(eventId, userId, preset);
  return jsonOk({ created, meals: await loadMealView(eventId) }, 201);
});
