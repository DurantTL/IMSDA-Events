import { isChoiceFieldType } from "@/modules/forms/definition";

/**
 * Changing a field to a choice type hides its field-level price input (choices
 * are priced one by one), so a price left behind could never be seen or edited
 * but would be charged on every selection once the choice price map is empty
 * (#680). Clear only what the builder can no longer show. Late pricing is
 * already cleared by the type change when the pricing kind changes.
 */
export function hiddenPricePatchForType(nextType: string): { priceCents?: undefined } {
  return isChoiceFieldType(nextType) ? { priceCents: undefined } : {};
}
