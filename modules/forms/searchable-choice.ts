export function normalizeChoiceSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function filterSearchableChoices<T extends { label: string }>(
  choices: readonly T[],
  query: string,
) {
  const terms = normalizeChoiceSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...choices];
  return choices.filter((choice) => {
    const searchable = normalizeChoiceSearch(choice.label);
    return terms.every((term) => searchable.includes(term));
  });
}

/**
 * The full-screen phone picker (#1046). Attributes for its search box: iOS offers
 * "AutoFill Contact" on anything it thinks is a contact field, so the name and
 * the label avoid contact words (name, email, phone, address, contact).
 */
export const PICKER_SEARCH_ATTRIBUTES = {
  name: "directory-search",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
  enterKeyHint: "search",
  "aria-label": "Search this list",
} as const;

/** The box the picker covers: the visual viewport, so the list ends at the top of the keyboard. */
export function pickerViewportBox(
  viewport: { height: number; offsetTop: number } | null | undefined,
): { top: number; height: number } | null {
  if (!viewport || !(viewport.height > 0)) return null;
  return { top: Math.max(0, Math.round(viewport.offsetTop)), height: Math.round(viewport.height) };
}

/** "12 choices", "1 choice", "No matching choices": announced as the search narrows. */
export function resultCountLabel(
  count: number,
  noun: { singular: string; plural: string } = { singular: "choice", plural: "choices" },
) {
  if (count === 0) return `No matching ${noun.plural}`;
  return `${count} ${count === 1 ? noun.singular : noun.plural}`;
}

/** Tab inside a focus trap: the stop focus should move to from `index` of `count` stops, or null to let the browser move it. */
export function trappedTabIndex(index: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (index < 0) return backwards ? count - 1 : 0;
  if (backwards && index === 0) return count - 1;
  if (!backwards && index === count - 1) return 0;
  return null;
}

/** "Pathfinder club" becomes { singular: "pathfinder club", plural: "pathfinder clubs" } for the announced count. */
export function nounFromLabel(label: string | undefined): { singular: string; plural: string } | undefined {
  const singular = label?.trim().toLocaleLowerCase();
  if (!singular) return undefined;
  const plural = /(s|x|ch|sh)$/.test(singular)
    ? `${singular}es`
    : /[^aeiou]y$/.test(singular) ? `${singular.slice(0, -1)}ies` : `${singular}s`;
  return { singular, plural };
}
