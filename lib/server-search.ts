/**
 * Shared mechanics for server-side text search: split a query into terms and
 * build Prisma "contains, case-insensitive" filters. Each caller keeps its own
 * field list and its own scoping (event, organization, role); this only builds
 * the text part. Pure, so the shapes are unit-testable.
 */

export type InsensitiveContains = { contains: string; mode: "insensitive" };

/** `{ contains: term, mode: "insensitive" }` for one Prisma string field. */
export function insensitiveContains(term: string): InsensitiveContains {
  return { contains: term, mode: "insensitive" };
}

/** `{ OR: [{ field: contains }, ...] }`: the term in at least one of the flat string `fields`. */
export function containsAnyOf<K extends string>(fields: readonly K[], term: string): { OR: Array<Record<K, InsensitiveContains>> } {
  return { OR: fields.map((field) => ({ [field]: insensitiveContains(term) }) as Record<K, InsensitiveContains>) };
}

export type SearchTermOptions = {
  /** Most words kept; the rest are ignored. */
  maxTerms: number;
  /** The query is cut to this length before it is split. */
  maxQueryLength?: number;
  /** Each word is cut to this length after the split. */
  maxTermLength?: number;
};

/** NFKC-normalise, trim and split on whitespace; blank words dropped, capped as `options` say. */
export function searchTerms(query: string, options: SearchTermOptions): string[] {
  const text = options.maxQueryLength === undefined ? query : query.slice(0, options.maxQueryLength);
  const terms = text.normalize("NFKC").trim().split(/\s+/).filter(Boolean).slice(0, options.maxTerms);
  return options.maxTermLength === undefined ? terms : terms.map((term) => term.slice(0, options.maxTermLength));
}

/** `{ AND: [...] }`: every term must satisfy `matchTerm` (typically an OR across fields). */
export function everyTermMatches<T>(terms: readonly string[], matchTerm: (term: string) => T): { AND: T[] } {
  return { AND: terms.map(matchTerm) };
}
