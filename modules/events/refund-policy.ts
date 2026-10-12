/**
 * Display helpers for an event's refund policy (#891).
 *
 * The policy is plain text staff type into event settings. Paragraphs are
 * separated by blank lines; a single line break inside a paragraph is kept.
 * Nothing here interprets markup: callers render each string as a React text
 * child (escaped) or Markdown-escape it for email, so authored text can never
 * become HTML.
 */
export function refundPolicyParagraphs(policy: string | null | undefined): string[] {
  if (!policy) return [];
  return policy
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.split("\n").map((line) => line.trim()).filter(Boolean).join("\n"))
    .filter(Boolean);
}

/** Whether there is anything to show. A blank or whitespace-only policy shows nothing, not even a heading. */
export function hasRefundPolicy(policy: string | null | undefined): boolean {
  return refundPolicyParagraphs(policy).length > 0;
}
