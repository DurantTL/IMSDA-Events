/** The word for a count: "club" for 1, "clubs" otherwise (so "0 clubs"). Pass `plural` for an irregular word. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** The count with its word, for example "1 club" or "2 clubs". */
export function countLabel(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
