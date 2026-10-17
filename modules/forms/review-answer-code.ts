/**
 * Whether a review-step answer is an email address or a code (a confirmation code, an id), which may break anywhere when the
 * line is narrow (#996). Ordinary words, even long ones ("Pathfinder", "Saturday"), never do: a code needs an "@", or a digit
 * among six or more letters, digits, hyphens and underscores.
 */
export function isCodeLikeAnswer(answer: unknown): boolean {
  if (typeof answer !== "string") return false;
  return /@|^(?=.*\d)[A-Za-z0-9_-]{6,}$/.test(answer.trim());
}
