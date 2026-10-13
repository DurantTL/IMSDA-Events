import { jsonOk, mealRoute } from "@/modules/meals/api";
import { loadRegistrationMeals } from "@/modules/meals/view-repository";

/** One registration's meal selections with every change and ledger entry, read-only, for the Finance detail (MANAGE_FINANCE). */
export const GET = mealRoute<{ registrationId: string }>("MANAGE_FINANCE", "Loading the registration's meals", async ({ eventId, params }) =>
  jsonOk({ selections: await loadRegistrationMeals(eventId, params.registrationId) }), { mutates: false });
