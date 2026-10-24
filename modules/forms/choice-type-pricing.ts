import { isChoiceFieldType } from "@/modules/forms/definition";
import type { RegistrationFormField } from "@/modules/forms/definition";

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
 * and the late price with it. A price on an ADDRESS is never meaningful, so
 * that clears whatever the previous type was. Otherwise it clears only when
 * the type moves from one that shows the price to one that hides it; moving
 * between choice types (SELECT to RADIO) keeps what is stored, so a price
 * charged today is not silently dropped.
 */
export function hiddenPricePatchForType(
  previousType: string,
  nextType: string,
): { priceCents?: undefined; latePricing?: undefined } {
  if (nextType === "ADDRESS") return { priceCents: undefined, latePricing: undefined };
  return hidesFieldPrice(nextType) && !hidesFieldPrice(previousType)
    ? { priceCents: undefined, latePricing: undefined }
    : {};
}

/**
 * The pricing part of the builder's type-change update. The hidden-price patch
 * is spread last, so it wins over the carried-over `latePricing`.
 */
export function pricingPatchForTypeChange(
  field: Pick<RegistrationFormField, "type" | "latePricing">,
  nextType: string,
): Partial<Pick<RegistrationFormField, "priceCents" | "latePricing">> {
  const changedPricingKind = isChoiceFieldType(nextType) !== isChoiceFieldType(field.type);
  return {
    latePricing: changedPricingKind ? undefined : field.latePricing,
    ...hiddenPricePatchForType(field.type, nextType),
  };
}
