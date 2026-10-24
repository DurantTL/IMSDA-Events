import { bundledEventContent } from "@/modules/event-content/seeded-data";
import { cancellationRulesFromPreset } from "@/modules/event-content/domain";
import type { CancellationRulesInput } from "@/modules/cancellation-policy/rules";
import type { TemplateMeals } from "@/modules/meals/clone-domain";

/**
 * The Camp Meeting 2026 meal preset and cancellation rule, read from the seeded data (#919) the way the app reads its
 * bundled copy. Before #919 these were `campMeetingMeals` and `campMeetingPreset` in shared source; the tests that used
 * them as realistic fixtures still do, and `tests/seeded-event-content-919.test.ts` proves the values are unchanged.
 */
const mealPreset = bundledEventContent.find((seed) => seed.kind === "MEAL_PRESET" && seed.key === "camp-meeting-2026");
const cancellationPreset = bundledEventContent.find((seed) => seed.kind === "CANCELLATION_PRESET" && seed.key === "camp-meeting-2026");
if (mealPreset?.kind !== "MEAL_PRESET" || cancellationPreset?.kind !== "CANCELLATION_PRESET") throw new Error("The Camp Meeting seed content is missing.");
const cancellationContent = cancellationPreset.content;

export const campMeetingMeals: TemplateMeals = mealPreset.content.meals;

export function campMeetingPreset(deadlineDate: string): CancellationRulesInput {
  return cancellationRulesFromPreset(cancellationContent, deadlineDate);
}
