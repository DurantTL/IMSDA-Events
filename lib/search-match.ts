/**
 * Word-based text search shared by the club pages' pickers and filters (#799 G2).
 *
 * Every typed word has to appear somewhere in the text, in any order, ignoring
 * case, accents, and punctuation. So "Smith, Jo" finds "Jo Smith", "shirt polo"
 * finds "Polo Shirt", and "ab 123" finds catalog number "AB-123". A blank
 * search matches everything. Each field is matched on its own, so a word never
 * matches across the join of two fields ("anna" does not find "Ann" + "Adams").
 */

function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

const NON_WORD = /[^\p{L}\p{N}]+/gu;

/** The words of a search: split on spaces and punctuation, accents removed. */
export function searchWords(query: string) {
  return fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Is there anything to search for? A blank or punctuation-only query is not a search. */
export function hasSearchText(query: string) {
  return searchWords(query).length > 0;
}

/** Builds the matcher once per query, then tests many rows with it. */
export function makeSearchMatcher(query: string) {
  const words = searchWords(query);
  return (fields: ReadonlyArray<string | null | undefined>) => {
    if (words.length === 0) return true;
    const folded = fields.filter((field): field is string => Boolean(field)).map(fold);
    // Spaced form for whole words; compact form per field so "AB-123" matches "ab123".
    const spaced = folded.map((field) => field.replace(NON_WORD, " "));
    const compact = folded.map((field) => field.replace(NON_WORD, ""));
    return words.every((word) => spaced.some((field) => field.includes(word)) || compact.some((field) => field.includes(word)));
  };
}

/** Does every word of `query` appear in one of the `fields`? */
export function matchesSearch(fields: ReadonlyArray<string | null | undefined>, query: string) {
  return makeSearchMatcher(query)(fields);
}

/**
 * The option a picker should treat as chosen: the one the person picked while
 * it is still listed, otherwise (only once something was typed) the only
 * match, otherwise none. Never an item the search has since hidden.
 */
export function effectiveChoice(chosenId: string, listed: ReadonlyArray<{ id: string }>, query: string) {
  if (chosenId && listed.some((entry) => entry.id === chosenId)) return chosenId;
  return hasSearchText(query) && listed.length === 1 ? listed[0]!.id : "";
}

/**
 * What a picker's search says it found (#918), shown next to the search box. A closed native
 * <select> (iPad Safari) gives no sign it was narrowed, so typing looked like it did nothing.
 * Empty while nothing is typed.
 */
export function searchResultSummary(count: number, query: string, noun: string, nounPlural = `${noun}s`) {
  if (!hasSearchText(query)) return "";
  const typed = query.trim();
  if (count === 0) return `No ${nounPlural} match \u201c${typed}\u201d. Clear the search to see every ${noun}.`;
  return count === 1 ? `1 ${noun} matches \u201c${typed}\u201d.` : `${count} ${nounPlural} match \u201c${typed}\u201d.`;
}

/**
 * Rows to show for a narrowed picker (#918): while a search has several matches the <select> is
 * drawn as an open list so the narrowed matches are visible without tapping it. Undefined otherwise
 * (a dropdown), and capped so a long match list scrolls inside the box.
 */
export function narrowedListSize(count: number, query: string, maxRows = 6) {
  if (!hasSearchText(query) || count < 2) return undefined;
  return Math.min(count + 1, maxRows);
}
