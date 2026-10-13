import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { jsonOk, mealRoute } from "@/modules/meals/api";
import { reinstateMealService, updateMealService } from "@/modules/meals/config-repository";
import { cancelMealService } from "@/modules/meals/selection-repository";
import { loadMealView } from "@/modules/meals/view-repository";

type Params = { serviceId: string };

/** Editing a service (not who it charges) is event setup. */
export const PUT = mealRoute<Params>("CONFIGURE_EVENT", "Saving the meal service", async ({ request, eventId, userId, params }) => {
  await updateMealService(eventId, params.serviceId, userId, await request.json());
  return jsonOk({ meals: await loadMealView(eventId) });
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string() }).strict(),
  z.object({ action: z.literal("reinstate"), reason: z.string() }).strict(),
]);

/**
 * Cancelling a service credits every order pinned to it, which moves money, so it takes MANAGE_FINANCE as well as
 * event setup. Reinstating moves none and is event setup.
 */
export const POST = mealRoute<Params>("CONFIGURE_EVENT", "Changing the meal service", async ({ request, eventId, userId, params }) => {
  const body = actionSchema.parse(await request.json());
  if (body.action === "cancel") {
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const result = await cancelMealService(eventId, params.serviceId, userId, { reason: body.reason });
    return jsonOk({ ...result, meals: await loadMealView(eventId) });
  }
  await reinstateMealService(eventId, params.serviceId, userId, body.reason);
  return jsonOk({ meals: await loadMealView(eventId) });
});
