/**
 * The Help hub's plain filter (#1077), in a module with no imports so a browser bundle that only filters a list (the portal Help
 * search, #1482) does not pull in the guide catalogue or staff navigation. `visibility.ts` re-exports it for the staff code.
 */
export const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every word typed must appear in the title, summary or keywords. */
export function filterGuides<T extends { title: string; summary: string; keywords: readonly string[] }>(guides: readonly T[], query: string): T[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...guides];
  return guides.filter((guide) => {
    const haystack = norm(`${guide.title} ${guide.summary} ${guide.keywords.join(" ")}`);
    return words.every((word) => haystack.includes(word));
  });
}
