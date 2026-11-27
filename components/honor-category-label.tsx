import { type HonorCategory, honorCategoryLabels } from "@/modules/honors/domain";

/**
 * Each category's chip tone (#2054). The label stands where a patch picture
 * would be, drawn with the shared status chip (G1). Ten categories share the
 * five chip tones, related ones together; the text always names the
 * category, so color is never the only way to tell them apart.
 */
export const honorCategoryTones = {
  NATURE: "green",
  OUTDOOR_INDUSTRIES: "green",
  RECREATION: "green",
  SPIRITUAL_GROWTH_OUTREACH_AND_HERITAGE: "purple",
  MASTER_AWARDS: "purple",
  HEALTH_AND_SCIENCE: "purple",
  ARTS_CRAFTS_AND_HOBBIES: "coral",
  HOUSEHOLD_ARTS: "coral",
  VOCATIONAL: "gold",
  MISCELLANEOUS_HONORS: "neutral",
} as const satisfies Record<HonorCategory, "green" | "purple" | "coral" | "gold" | "neutral">;

/** An honor's category as a colored label. Nothing when the honor has no category. */
export function HonorCategoryLabel({ category }: { category: HonorCategory | null | undefined }) {
  if (!category) return null;
  return <span className={`status-chip ${honorCategoryTones[category]}`} data-honor-category={category}>{honorCategoryLabels[category]}</span>;
}
