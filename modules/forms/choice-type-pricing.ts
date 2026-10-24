import { isChoiceFieldType } from "@/modules/forms/definition";

/**
 * Field types whose field-level price input the builder hides: choices are
 * priced one by one, and an address has no price row. One predicate, used by
 * the advanced panel and by `hiddenPricePatchForType`, so they cannot drift (#680).
 */
export function hidesFieldPrice(type: string): boolean {
  return isChoiceFieldType(type) || type === "ADDRESS";
}

/**
 * A price left behind when a field moves into a type that hides the price
 * input could never be seen or edited, yet is still charged (#680). Clear it,
 * and the late price with it, only when the type moves from one that shows the
 * price to one that hides it. Moving between two hidden-price types (SELECT to
 * RADIO) keeps whatever is stored, so a price charged today is not silently dropped.
 */
export function hiddenPricePatchForType(
  previousType: string,
  nextType: string,
): { priceCents?: undefined; latePricing?: undefined } {
  return hidesFieldPrice(nextType) && !hidesFieldPrice(previousType)
    ? { priceCents: undefined, latePricing: undefined }
    : {};
}
